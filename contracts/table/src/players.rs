//! Signed commands from players.
//!
//! A player is an ed25519 key made in the browser. Every command is the
//! string `facedown|<contract>|<player>|<nonce>|<payload>` signed by that key,
//! where `payload` is the JSON of a [`Command`]. Anyone may submit it; the
//! nonce stops replays and the signature stops forgeries.

use near_sdk::json_types::U64;
use near_sdk::{env, near, require, Promise};

use crate::*;

pub fn signed_message(contract: &str, player: &str, nonce: u64, payload: &str) -> String {
    format!("facedown|{contract}|{player}|{nonce}|{payload}")
}

fn valid_name(name: &str) -> bool {
    let n = name.trim();
    (2..=MAX_NAME).contains(&n.chars().count())
        && n.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == ' ')
}

fn hex32(value: &str) -> bool {
    value.len() == 64 && hex::decode(value).is_ok()
}

#[near]
impl Facedown {
    /// Submits a player's signed command. Returns a dealer request when the
    /// command moved a hand to a point where the dealer must act.
    pub fn relay(
        &mut self,
        player: String,
        nonce: U64,
        payload: String,
        signature: String,
    ) -> Option<Promise> {
        require!(hex32(&player), "player is a 32-byte ed25519 key in hex");
        let sig: [u8; 64] = hex::decode(&signature)
            .ok()
            .and_then(|s| s.try_into().ok())
            .unwrap_or_else(|| env::panic_str("signature is 64 bytes of hex"));
        let key: [u8; 32] = hex::decode(&player).unwrap().try_into().unwrap();
        let message = signed_message(
            env::current_account_id().as_str(),
            &player,
            nonce.0,
            &payload,
        );
        require!(
            env::ed25519_verify(&sig, message.as_bytes(), &key),
            "bad signature"
        );
        let command: Command = near_sdk::serde_json::from_str(&payload)
            .unwrap_or_else(|e| env::panic_str(&format!("bad command: {e}")));

        if let Command::Register { name, xpub } = command {
            require!(nonce.0 == 0, "a new player starts at nonce 0");
            return {
                self.register(player, name, xpub);
                None
            };
        }
        let mut record = self
            .players
            .get(&player)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown player"));
        require!(nonce.0 == record.nonce, "stale or future nonce");
        record.nonce += 1;
        self.players.insert(player.clone(), record);

        match command {
            Command::Register { .. } => unreachable!(),
            Command::Claim => {
                self.claim(&player);
                None
            }
            Command::SetXpub { xpub } => {
                require!(hex32(&xpub), "xpub is a 32-byte x25519 key in hex");
                self.players.get_mut(&player).unwrap().xpub = xpub;
                None
            }
            Command::Sit {
                table,
                seat,
                buy_in,
            } => self.sit(&player, table, seat, buy_in.0),
            Command::Leave { table } => {
                self.leave(&player, table);
                None
            }
            Command::Act {
                table,
                hand,
                action,
            } => self.player_act(&player, table, hand.0, action),
            Command::OpenTable {
                name,
                small_blind,
                max_seats,
                bots,
            } => {
                self.open_table(name, small_blind.0, max_seats, &bots, Some(player));
                None
            }
        }
    }
}

impl Facedown {
    fn register(&mut self, player: String, name: String, xpub: String) {
        require!(
            self.players.get(&player).is_none(),
            "this key is already registered"
        );
        require!(
            valid_name(&name),
            "names are 2-20 letters, digits, spaces, _ or -"
        );
        require!(hex32(&xpub), "xpub is a 32-byte x25519 key in hex");
        let name = name.trim().to_string();
        let lower = name.to_lowercase();
        require!(
            !lower.contains("bot") && self.names.get(&lower).is_none(),
            "that name is taken"
        );
        self.names.insert(lower, player.clone());
        let now = env::block_timestamp_ms();
        self.players.insert(
            player,
            PlayerRecord {
                name,
                xpub,
                chips: STARTING_CHIPS,
                nonce: 1,
                last_claim_ms: now,
                hands_played: 0,
                hands_won: 0,
                net: 0,
                joined_ms: now,
            },
        );
    }

    fn claim(&mut self, player: &str) {
        let now = env::block_timestamp_ms();
        let record = self.players.get_mut(player).unwrap();
        require!(
            now >= record.last_claim_ms + CLAIM_EVERY_MS,
            "free chips refill every 4 hours"
        );
        record.chips += CLAIM_CHIPS;
        record.last_claim_ms = now;
    }

    fn sit(&mut self, player: &str, table_id: u32, seat: u8, buy_in: u64) -> Option<Promise> {
        let name = self.players.get(player).unwrap().name.clone();
        let chips = self.players.get(player).unwrap().chips;
        let table = self.table_mut(table_id);
        let bb = table.big_blind.0;
        require!((seat as usize) < table.seats.len(), "no such seat");
        require!(table.seats[seat as usize].is_none(), "seat taken");
        require!(
            table.seats.iter().flatten().all(|s| s.player != player),
            "already at this table"
        );
        require!(
            buy_in >= 20 * bb && buy_in <= 200 * bb,
            "buy in for 20 to 200 big blinds"
        );
        require!(buy_in <= chips, "not enough chips");
        table.seats[seat as usize] = Some(Seat {
            player: player.to_string(),
            name,
            stack: buy_in,
            bot: None,
            leaving: false,
            timeouts: 0,
            sitting_out: false,
        });
        self.players.get_mut(player).unwrap().chips -= buy_in;
        self.try_start(table_id)
    }

    fn leave(&mut self, player: &str, table_id: u32) {
        let table = self.table_mut(table_id);
        let index = table
            .seats
            .iter()
            .position(|s| s.as_ref().is_some_and(|s| s.player == player))
            .unwrap_or_else(|| env::panic_str("not seated here"));
        let in_hand = table.hand.as_ref().is_some_and(|h| {
            h.ids
                .iter()
                .position(|id| id == player)
                .is_some_and(|p| !h.betting.players[p].folded)
        });
        if in_hand {
            // Stand up after this hand; until then, timeouts fold for them.
            table.seats[index].as_mut().unwrap().leaving = true;
            return;
        }
        // Folded or between hands: the seat's chips are settled already
        // unless a hand is running, in which case they were put in the pot.
        let stack = match &table.hand {
            Some(h) => h
                .ids
                .iter()
                .position(|id| id == player)
                .map(|p| h.betting.players[p].stack)
                .unwrap_or(table.seats[index].as_ref().unwrap().stack),
            None => table.seats[index].as_ref().unwrap().stack,
        };
        let still_dealt = table
            .hand
            .as_ref()
            .is_some_and(|h| h.ids.iter().any(|id| id == player));
        if still_dealt {
            // Folded in a live hand: keep the seat object until settle so the
            // hand's positions stay valid, but mark it leaving.
            table.seats[index].as_mut().unwrap().leaving = true;
            return;
        }
        table.seats[index] = None;
        self.players.get_mut(player).unwrap().chips += stack;
    }

    pub(crate) fn table_mut(&mut self, id: u32) -> &mut Table {
        self.tables
            .get_mut(id)
            .unwrap_or_else(|| env::panic_str("no such table"))
    }
}
