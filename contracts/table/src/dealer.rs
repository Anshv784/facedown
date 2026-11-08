//! Talking to the dealer: an OutLayer project running in a TDX enclave.
//!
//! The contract records each job as `Pending` and sends it here. The callback
//! checks what came back before using it. Callbacks never send the next job
//! themselves (gas); the next `relay` or `advance` call does.

use facedown_core::cards::Card;
use facedown_core::game::{Action, Street};
use near_sdk::json_types::U64;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, Promise};

use crate::*;

const OUTLAYER_GAS: Gas = Gas::from_tgas(80);
const CALLBACK_GAS: Gas = Gas::from_tgas(110);
const OUTLAYER_DEPOSIT: NearToken = NearToken::from_millinear(25);
const MAX_OUTPUT: usize = 16 * 1024;
const MAX_ATTEMPTS: u32 = 3;

#[allow(dead_code)]
#[ext_contract(ext_outlayer)]
trait OutLayer {
    fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
        payer_account_id: Option<AccountId>,
    );
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct VrfOut {
    output: String,
    signature: String,
    alpha: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct HoleOut {
    position: u8,
    epk: String,
    ct: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct DealOut {
    vrf: VrfOut,
    salt_commit: String,
    holes: Vec<HoleOut>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct BoardOut {
    cards: Vec<Card>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct FinishOut {
    salt: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct BotOut {
    action: Action,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct DealPlayer {
    position: u8,
    seat: u8,
    /// Empty for bots: their cards stay inside the enclave.
    xpub: String,
}

/// The VRF seed for a hand. It can't contain ':' (OutLayer's delimiter).
pub fn vrf_seed(table: u32, hand: u64) -> String {
    format!("facedown-{table}-{hand}")
}

/// Checks a VRF result: the proof verifies under OutLayer's key, the output
/// is SHA-256 of the proof, and the seed is this hand's.
pub fn verify_vrf(
    vrf_key: &[u8; 32],
    output: &str,
    signature: &str,
    alpha: &str,
    seed: &str,
) -> Result<[u8; 32], &'static str> {
    let sig: [u8; 64] = hex::decode(signature)
        .ok()
        .and_then(|s| s.try_into().ok())
        .ok_or("malformed VRF signature")?;
    let out: [u8; 32] = hex::decode(output)
        .ok()
        .and_then(|s| s.try_into().ok())
        .ok_or("malformed VRF output")?;
    if !alpha.starts_with("vrf:") || !alpha.ends_with(&format!(":{seed}")) {
        return Err("VRF proof is for a different seed");
    }
    if !env::ed25519_verify(&sig, alpha.as_bytes(), vrf_key) {
        return Err("VRF proof does not verify");
    }
    if env::sha256_array(sig) != out {
        return Err("VRF output is not the hash of its proof");
    }
    Ok(out)
}

#[near]
impl Facedown {
    /// OutLayer's answer to a dealer job.
    #[private]
    pub fn on_dealer(&mut self, table: u32, hand: U64, task: DealerTask) {
        let Some(t) = self.tables.get(table) else {
            return;
        };
        let current = t
            .hand
            .as_ref()
            .is_some_and(|h| h.no == hand && h.pending.as_ref().is_some_and(|p| p.task == task));
        if !current {
            return; // a late answer for a job that's no longer waiting
        }
        let raw = match env::promise_result_checked(0, MAX_OUTPUT) {
            Ok(bytes) => bytes,
            Err(_) => return self.dealer_failed(table, "OutLayer did not run the dealer".into()),
        };
        let value: Value = match serde_json::from_slice(&raw) {
            Ok(v) => v,
            Err(_) => return self.dealer_failed(table, "the dealer's answer is not JSON".into()),
        };
        if let Some(error) = value.get("error").and_then(|e| e.as_str()) {
            return self.dealer_failed(table, format!("dealer: {error}"));
        }
        let result = match task {
            DealerTask::Deal => self.took_deal(table, hand.0, value),
            DealerTask::Board { street } => self.took_board(table, street, value),
            DealerTask::Finish => match serde_json::from_value::<FinishOut>(value) {
                Ok(f) => {
                    self.settle(table, &f.salt);
                    Ok(())
                }
                Err(_) => Err("malformed finish".into()),
            },
            DealerTask::Bot { position } => self.took_bot(table, position as usize, value),
        };
        if let Err(reason) = result {
            self.dealer_failed(table, reason);
        }
    }
}

impl Facedown {
    /// Sends the waiting dealer job if there's gas for it and it isn't in
    /// flight. Returns the promise to chain onto the caller's transaction.
    pub(crate) fn kick(&mut self, table_id: u32) -> Option<Promise> {
        let dealer = self.dealer.clone();
        let t = self.tables.get(table_id)?;
        let hand = t.hand.as_ref()?;
        let pending = hand.pending.as_ref()?;
        let now = env::block_timestamp_ms();
        if pending.sent_ms.0 > 0 && now < pending.sent_ms.0 + DEALER_RETRY_MS {
            return None;
        }
        let left = env::prepaid_gas().saturating_sub(env::used_gas());
        if left
            < OUTLAYER_GAS
                .saturating_add(CALLBACK_GAS)
                .saturating_add(Gas::from_tgas(15))
        {
            return None;
        }
        let input = self.job_input(t, hand, &pending.task);
        let task = pending.task.clone();
        let no = hand.no;
        let t = self.table_mut(table_id);
        t.hand.as_mut().unwrap().pending.as_mut().unwrap().sent_ms = U64(now);
        Some(
            ext_outlayer::ext(dealer.outlayer.clone())
                .with_attached_deposit(OUTLAYER_DEPOSIT)
                .with_static_gas(OUTLAYER_GAS)
                .request_execution(
                    json!({ "Project": { "project_id": dealer.project_id } }),
                    Some(json!({ "max_instructions": 20_000_000_000u64, "max_memory_mb": 128, "max_execution_seconds": 60 })),
                    Some(input),
                    Some(json!({ "profile": dealer.secrets_profile, "account_id": dealer.secrets_owner })),
                    Some("Json".into()),
                    Some(env::current_account_id()),
                )
                .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_dealer(table_id, no, task)),
        )
    }

    fn job_input(&self, t: &Table, hand: &Hand, task: &DealerTask) -> String {
        let n = hand.ids.len();
        let vrf = hand
            .vrf
            .as_ref()
            .map(|v| v.output.clone())
            .unwrap_or_default();
        let base = json!({ "table": t.id, "hand": hand.no.0, "players": n });
        let mut v = match task {
            DealerTask::Deal => {
                let players: Vec<DealPlayer> = (0..n)
                    .map(|p| {
                        let seat = hand.betting.players[p].seat;
                        let xpub = self
                            .players
                            .get(&hand.ids[p])
                            .map(|r| r.xpub.clone())
                            .unwrap_or_default();
                        DealPlayer {
                            position: p as u8,
                            seat,
                            xpub,
                        }
                    })
                    .collect();
                json!({ "op": "deal", "seed": vrf_seed(t.id, hand.no.0), "seats": players })
            }
            DealerTask::Board { street } => json!({ "op": "board", "vrf": vrf, "street": street }),
            DealerTask::Finish => json!({ "op": "finish", "vrf": vrf }),
            DealerTask::Bot { position } => {
                let p = *position as usize;
                let b = &hand.betting;
                let o = b.options(p);
                let style = t.seats[b.players[p].seat as usize]
                    .as_ref()
                    .and_then(|s| s.bot)
                    .unwrap_or(BotStyle::Rock);
                json!({
                    "op": "bot", "vrf": vrf, "position": p, "style": style,
                    "street": b.street, "board": hand.board, "pot": b.pot(),
                    "to_call": o.to_call, "can_check": o.can_check, "can_raise": o.can_raise,
                    "min_raise_to": o.min_raise_to, "max_raise_to": o.max_raise_to,
                    "bet": b.players[p].bet, "big_blind": b.big_blind,
                    "opponents": b.players.iter().enumerate().filter(|(i, q)| *i != p && !q.folded).count(),
                })
            }
        };
        let obj = v.as_object_mut().unwrap();
        for (k, val) in base.as_object().unwrap() {
            obj.insert(k.clone(), val.clone());
        }
        v.to_string()
    }

    fn took_deal(&mut self, table_id: u32, hand_no: u64, value: Value) -> Result<(), String> {
        let out: DealOut = serde_json::from_value(value).map_err(|_| "malformed deal")?;
        let key = self.dealer.vrf_key();
        verify_vrf(
            &key,
            &out.vrf.output,
            &out.vrf.signature,
            &out.vrf.alpha,
            &vrf_seed(table_id, hand_no),
        )?;
        let commit_ok = hex::decode(&out.salt_commit)
            .map(|c| c.len() == 32)
            .unwrap_or(false);
        if !commit_ok {
            return Err("malformed salt commitment".into());
        }
        let t = self.table_mut(table_id);
        let hand = t.hand.as_mut().unwrap();
        let n = hand.ids.len();
        let mut holes = Vec::with_capacity(n);
        for p in 0..n {
            let seat = hand.betting.players[p].seat;
            let is_bot = t.seats[seat as usize]
                .as_ref()
                .is_some_and(|s| s.bot.is_some());
            match out.holes.iter().find(|h| h.position as usize == p) {
                Some(h) => holes.push(SealedHole {
                    position: p as u8,
                    seat,
                    epk: h.epk.clone(),
                    ct: h.ct.clone(),
                }),
                None if is_bot => {}
                None => return Err(format!("no sealed cards for position {p}")),
            }
        }
        hand.vrf = Some(Vrf {
            output: out.vrf.output,
            signature: out.vrf.signature,
            alpha: out.vrf.alpha,
        });
        hand.salt_commit = Some(out.salt_commit);
        hand.holes = holes;
        hand.pending = None;
        // Betting opens; the first player may be a bot.
        let first = hand.betting.to_act;
        match first {
            Some(player) => self.after(table_id, facedown_core::game::Progress::ToAct { player }),
            // Everyone is all-in from the blinds.
            None => self.after(table_id, facedown_core::game::Progress::RunOut),
        }
        Ok(())
    }

    fn took_board(&mut self, table_id: u32, street: Street, value: Value) -> Result<(), String> {
        let out: BoardOut = serde_json::from_value(value).map_err(|_| "malformed board")?;
        let t = self.table_mut(table_id);
        let hand = t.hand.as_mut().unwrap();
        let want = street.board_len() - hand.board.len();
        if out.cards.len() != want
            || out
                .cards
                .iter()
                .any(|&c| c >= 52 || hand.board.contains(&c))
        {
            return Err("the dealer sent the wrong board cards".into());
        }
        hand.board.extend(out.cards);
        hand.pending = None;
        let progress = hand.betting.start_street(street);
        self.after(table_id, progress);
        Ok(())
    }

    fn took_bot(&mut self, table_id: u32, position: usize, value: Value) -> Result<(), String> {
        let t = self.tables.get(table_id).unwrap();
        let hand = t.hand.as_ref().unwrap();
        if hand.betting.to_act != Some(position) {
            return Ok(());
        }
        let wanted = serde_json::from_value::<BotOut>(value)
            .map(|b| b.action)
            .ok();
        // An illegal or missing bot move becomes its timeout move.
        let mut probe = hand.betting.clone();
        let action = match wanted {
            Some(a) if probe.act(position, a).is_ok() => a,
            _ => hand.betting.timeout_action(position),
        };
        let t = self.table_mut(table_id);
        t.hand.as_mut().unwrap().pending = None;
        self.apply(table_id, position, action, false);
        Ok(())
    }

    /// A dealer job failed: retry on the next `advance`, or after three
    /// failures void the hand so every chip goes back.
    fn dealer_failed(&mut self, table_id: u32, reason: String) {
        let t = self.table_mut(table_id);
        let pending = t.hand.as_mut().unwrap().pending.as_mut().unwrap();
        pending.attempts += 1;
        pending.sent_ms = U64(0);
        if pending.attempts as u32 >= MAX_ATTEMPTS {
            self.void_hand(table_id, reason);
        } else {
            env::log_str(&format!("dealer job failed, will retry: {reason}"));
        }
    }
}
