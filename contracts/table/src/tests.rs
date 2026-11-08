//! Whole hands through the real contract, with the test playing OutLayer:
//! it signs genuine VRF proofs with a test key and answers each dealer job
//! with exactly what the enclave would send.

use ed25519_dalek::{Signer, SigningKey};
use facedown_core::deck::{salt_commitment, Layout};
use facedown_core::game::Street;
use near_sdk::json_types::U64;
use near_sdk::serde_json::{json, Value};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, PromiseResult, RuntimeFeesConfig};

use crate::players::signed_message;
use crate::*;

const CONTRACT: &str = "facedown.testnet";
const VRF_SEED: [u8; 32] = [42; 32];
const SALT: [u8; 32] = [7; 32];

fn contract_id() -> AccountId {
    CONTRACT.parse().unwrap()
}

fn context(predecessor: &str, now_ms: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract_id())
        .predecessor_account_id(predecessor.parse().unwrap())
        .signer_account_id(predecessor.parse().unwrap())
        .block_timestamp(now_ms * 1_000_000);
    b
}

fn at(predecessor: &str, now_ms: u64) {
    testing_env!(context(predecessor, now_ms).build());
}

fn with_result(now_ms: u64, result: Value) {
    testing_env!(
        context(CONTRACT, now_ms).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(result.to_string().into_bytes())],
    );
}

fn vrf_key() -> SigningKey {
    SigningKey::from_bytes(&VRF_SEED)
}

fn new_contract() -> Facedown {
    at("owner.testnet", 1_000);
    Facedown::new(
        "owner.testnet".parse().unwrap(),
        DealerConfig {
            outlayer: "outlayer.testnet".parse().unwrap(),
            project_id: "owner.testnet/facedown-dealer".into(),
            secrets_owner: "owner.testnet".parse().unwrap(),
            secrets_profile: "default".into(),
            vrf_pubkey: hex::encode(vrf_key().verifying_key().to_bytes()),
        },
    )
}

struct Player {
    key: SigningKey,
    nonce: u64,
}

impl Player {
    fn new(seed: u8) -> Self {
        Player {
            key: SigningKey::from_bytes(&[seed; 32]),
            nonce: 0,
        }
    }
    fn id(&self) -> String {
        hex::encode(self.key.verifying_key().to_bytes())
    }
    fn send(&mut self, c: &mut Facedown, payload: Value, now_ms: u64) {
        at("relayer.testnet", now_ms);
        let payload = payload.to_string();
        let msg = signed_message(CONTRACT, &self.id(), self.nonce, &payload);
        let sig = hex::encode(self.key.sign(msg.as_bytes()).to_bytes());
        let _ = c.relay(self.id(), U64(self.nonce), payload, sig);
        self.nonce += 1;
    }
}

/// Plays OutLayer: answers the waiting dealer job for `table`.
fn deal_job(c: &mut Facedown, table: u32, now_ms: u64) -> DealerTask {
    let t = c.get_table(table).unwrap();
    let hand = t.hand.unwrap();
    let task = hand.pending.clone().unwrap().task;
    let n = hand.ids.len();
    let answer = match &task {
        DealerTask::Deal => {
            let seed = dealer::vrf_seed(table, hand.no.0);
            let alpha = format!("vrf:1:relayer.testnet:{seed}");
            let sig = vrf_key().sign(alpha.as_bytes()).to_bytes();
            let output = near_sdk::env::sha256_array(sig);
            let holes: Vec<Value> = (0..n)
                .map(|p| json!({"position": p, "epk": "00".repeat(32), "ct": "11".repeat(18)}))
                .collect();
            json!({"vrf": {"output": hex::encode(output), "signature": hex::encode(sig), "alpha": alpha},
                   "salt_commit": hex::encode(salt_commitment(&SALT)), "holes": holes})
        }
        DealerTask::Board { street } => {
            let layout = layout_for(&hand);
            let board = layout.board();
            let cards: Vec<u8> = board[hand.board.len()..street.board_len()].to_vec();
            json!({"cards": cards})
        }
        DealerTask::Finish => json!({"salt": hex::encode(SALT)}),
        DealerTask::Bot { .. } => json!({"action": {"kind": "call"}}),
    };
    with_result(now_ms, answer);
    c.on_dealer(table, hand.no, task.clone());
    task
}

fn layout_for(hand: &Hand) -> Layout {
    let out: [u8; 32] = hex::decode(&hand.vrf.as_ref().unwrap().output)
        .unwrap()
        .try_into()
        .unwrap();
    Layout::new(&out, &SALT, hand.ids.len())
}

fn setup_heads_up() -> (Facedown, Player, Player) {
    let mut c = new_contract();
    let (mut a, mut b) = (Player::new(1), Player::new(2));
    a.send(
        &mut c,
        json!({"do": "register", "name": "alice", "xpub": "aa".repeat(32)}),
        2_000,
    );
    b.send(
        &mut c,
        json!({"do": "register", "name": "bob", "xpub": "bb".repeat(32)}),
        2_000,
    );
    a.send(
        &mut c,
        json!({"do": "open_table", "name": "Test", "small_blind": "5", "max_seats": 2, "bots": []}),
        3_000,
    );
    a.send(
        &mut c,
        json!({"do": "sit", "table": 0, "seat": 0, "buy_in": "1000"}),
        4_000,
    );
    b.send(
        &mut c,
        json!({"do": "sit", "table": 0, "seat": 1, "buy_in": "1000"}),
        4_000,
    );
    (c, a, b)
}

fn act(p: &mut Player, c: &mut Facedown, action: Value, now_ms: u64) {
    let no = c.get_table(0).unwrap().hand.unwrap().no;
    p.send(
        c,
        json!({"do": "act", "table": 0, "hand": no, "action": action}),
        now_ms,
    );
}

fn total_chips(c: &Facedown, ids: &[String]) -> u64 {
    let t = c.get_table(0).unwrap();
    let at_table: u64 = match &t.hand {
        Some(h) => h.betting.players.iter().map(|p| p.stack + p.total).sum(),
        None => t.seats.iter().flatten().map(|s| s.stack).sum(),
    };
    at_table
        + ids
            .iter()
            .map(|id| c.get_player(id.clone()).unwrap().chips)
            .sum::<u64>()
}

#[test]
fn players_register_with_unique_names_and_chips() {
    let (c, a, b) = setup_heads_up();
    assert_eq!(c.get_player(a.id()).unwrap().chips, STARTING_CHIPS - 1000);
    assert_eq!(c.find_player("ALICE".into()).unwrap().0, a.id());
    assert_eq!(total_chips(&c, &[a.id(), b.id()]), 2 * STARTING_CHIPS);
}

#[test]
#[should_panic(expected = "that name is taken")]
fn names_are_unique() {
    let (mut c, _a, _b) = setup_heads_up();
    let mut d = Player::new(3);
    d.send(
        &mut c,
        json!({"do": "register", "name": "Alice", "xpub": "cc".repeat(32)}),
        5_000,
    );
}

#[test]
#[should_panic(expected = "bad signature")]
fn forged_commands_are_refused() {
    let (mut c, a, _b) = setup_heads_up();
    at("relayer.testnet", 5_000);
    let payload = json!({"do": "claim"}).to_string();
    let wrong = SigningKey::from_bytes(&[9; 32]);
    let sig = hex::encode(
        wrong
            .sign(signed_message(CONTRACT, &a.id(), 3, &payload).as_bytes())
            .to_bytes(),
    );
    c.relay(a.id(), U64(3), payload, sig);
}

#[test]
#[should_panic(expected = "stale or future nonce")]
fn replays_are_refused() {
    let (mut c, mut a, _b) = setup_heads_up();
    a.nonce -= 1; // resend the last nonce
    a.send(&mut c, json!({"do": "claim"}), 5_000);
}

#[test]
fn a_full_hand_to_showdown_pays_the_best_hand() {
    let (mut c, mut a, mut b) = setup_heads_up();
    let ids = [a.id(), b.id()];
    assert_eq!(deal_job(&mut c, 0, 5_000), DealerTask::Deal);
    let hand = c.get_table(0).unwrap().hand.unwrap();
    assert_eq!(hand.holes.len(), 2, "each player got sealed cards");
    // Heads-up: the button (seat 0, alice) acts first preflop.
    assert_eq!(hand.betting.to_act, Some(0));
    act(&mut a, &mut c, json!({"kind": "call"}), 6_000);
    act(&mut b, &mut c, json!({"kind": "check"}), 6_500);
    for (street, t) in [
        (Street::Flop, 7_000),
        (Street::Turn, 8_000),
        (Street::River, 9_000),
    ] {
        assert_eq!(deal_job(&mut c, 0, t), DealerTask::Board { street });
        assert_eq!(
            c.get_table(0).unwrap().hand.unwrap().board.len(),
            street.board_len()
        );
        // Postflop the big blind (bob) acts first.
        act(&mut b, &mut c, json!({"kind": "check"}), t + 100);
        act(&mut a, &mut c, json!({"kind": "check"}), t + 200);
    }
    assert_eq!(deal_job(&mut c, 0, 10_000), DealerTask::Finish);

    let t = c.get_table(0).unwrap();
    assert!(t.hand.is_none());
    let rec = c.get_hand(0, U64(1)).unwrap();
    assert!(matches!(rec.outcome, Outcome::Showdown));
    assert_eq!(rec.pot.0, 20);
    assert_eq!(rec.board.len(), 5);
    // The record's cards are exactly the audited deck.
    let layout = Layout::new(
        &hex::decode(&rec.vrf.unwrap().output)
            .unwrap()
            .try_into()
            .unwrap(),
        &SALT,
        2,
    );
    assert_eq!(rec.hands[0].cards, layout.hole(0));
    let (s0, s1) = (rec.hands[0].score, rec.hands[1].score);
    let won: Vec<u64> = rec.hands.iter().map(|h| h.won.0).collect();
    match s0.cmp(&s1) {
        std::cmp::Ordering::Greater => assert_eq!(won, vec![20, 0]),
        std::cmp::Ordering::Less => assert_eq!(won, vec![0, 20]),
        std::cmp::Ordering::Equal => assert_eq!(won, vec![10, 10]),
    }
    assert_eq!(
        total_chips(&c, &ids),
        2 * STARTING_CHIPS,
        "no chip created or lost"
    );
}

#[test]
fn a_fold_ends_the_hand_and_the_deck_is_still_published() {
    let (mut c, mut a, b) = setup_heads_up();
    deal_job(&mut c, 0, 5_000);
    act(&mut a, &mut c, json!({"kind": "fold"}), 6_000);
    assert_eq!(deal_job(&mut c, 0, 7_000), DealerTask::Finish);
    let rec = c.get_hand(0, U64(1)).unwrap();
    assert!(matches!(rec.outcome, Outcome::Uncontested));
    assert_eq!(rec.salt.as_deref(), Some(hex::encode(SALT).as_str()));
    assert_eq!(rec.hands[1].won.0, 15);
    assert_eq!(total_chips(&c, &[a.id(), b.id()]), 2 * STARTING_CHIPS);
}

#[test]
fn all_in_preflop_runs_out_the_board() {
    let (mut c, mut a, mut b) = setup_heads_up();
    deal_job(&mut c, 0, 5_000);
    act(&mut a, &mut c, json!({"kind": "all_in"}), 6_000);
    act(&mut b, &mut c, json!({"kind": "call"}), 6_500);
    // No board jobs: the finish reveals everything at once.
    assert_eq!(deal_job(&mut c, 0, 7_000), DealerTask::Finish);
    let rec = c.get_hand(0, U64(1)).unwrap();
    assert_eq!(rec.board.len(), 5);
    assert_eq!(rec.pot.0, 2000);
    assert_eq!(total_chips(&c, &[a.id(), b.id()]), 2 * STARTING_CHIPS);
}

#[test]
fn a_dealer_that_swaps_the_salt_gets_the_hand_voided() {
    let (mut c, mut a, b) = setup_heads_up();
    deal_job(&mut c, 0, 5_000);
    act(&mut a, &mut c, json!({"kind": "raise", "to": 100}), 6_000);
    let no = c.get_table(0).unwrap().hand.unwrap().no;
    // Fold, then answer the finish with a different salt.
    let mut b = b;
    act(&mut b, &mut c, json!({"kind": "fold"}), 6_500);
    with_result(7_000, json!({"salt": hex::encode([8u8; 32])}));
    c.on_dealer(0, no, DealerTask::Finish);
    let rec = c.get_hand(0, no).unwrap();
    assert!(
        matches!(rec.outcome, Outcome::Voided { .. }),
        "{:?}",
        rec.outcome
    );
    // Every chip went back where it was before the hand.
    let t = c.get_table(0).unwrap();
    assert_eq!(t.seats[0].as_ref().unwrap().stack, 1000);
    assert_eq!(t.seats[1].as_ref().unwrap().stack, 1000);
}

#[test]
fn a_forged_vrf_is_refused_and_the_deal_retried() {
    let (mut c, _a, _b) = setup_heads_up();
    let no = c.get_table(0).unwrap().hand.unwrap().no;
    let alpha = format!("vrf:1:x:{}", dealer::vrf_seed(0, no.0));
    let forger = SigningKey::from_bytes(&[5; 32]);
    let sig = forger.sign(alpha.as_bytes()).to_bytes();
    with_result(
        5_000,
        json!({"vrf": {"output": hex::encode(near_sdk::env::sha256_array(sig)), "signature": hex::encode(sig), "alpha": alpha},
        "salt_commit": "00".repeat(32), "holes": []}),
    );
    c.on_dealer(0, no, DealerTask::Deal);
    let hand = c.get_table(0).unwrap().hand.unwrap();
    assert!(hand.vrf.is_none(), "nothing was accepted");
    assert_eq!(hand.pending.unwrap().attempts, 1);
}

#[test]
fn a_vrf_for_another_hand_is_refused() {
    let (mut c, _a, _b) = setup_heads_up();
    let no = c.get_table(0).unwrap().hand.unwrap().no;
    let alpha = format!("vrf:1:x:{}", dealer::vrf_seed(0, no.0 + 1));
    let sig = vrf_key().sign(alpha.as_bytes()).to_bytes();
    with_result(
        5_000,
        json!({"vrf": {"output": hex::encode(near_sdk::env::sha256_array(sig)), "signature": hex::encode(sig), "alpha": alpha},
        "salt_commit": "00".repeat(32), "holes": [{"position":0,"epk":"00","ct":"00"},{"position":1,"epk":"00","ct":"00"}]}),
    );
    c.on_dealer(0, no, DealerTask::Deal);
    assert!(c.get_table(0).unwrap().hand.unwrap().vrf.is_none());
}

#[test]
fn timeouts_fold_and_sit_out_after_two() {
    let (mut c, a, b) = setup_heads_up();
    deal_job(&mut c, 0, 5_000);
    // Alice (to act, facing the big blind) times out: she folds.
    at("anyone.testnet", 5_000 + ACTION_TIMEOUT_MS + 1);
    c.advance(0);
    let rec_pending = c.get_table(0).unwrap().hand.unwrap();
    assert_eq!(rec_pending.pending.unwrap().task, DealerTask::Finish);
    assert!(rec_pending.log.last().unwrap().timed_out);
    deal_job(&mut c, 0, 40_000);
    assert_eq!(
        c.get_table(0).unwrap().seats[0].as_ref().unwrap().timeouts,
        1
    );
    assert_eq!(total_chips(&c, &[a.id(), b.id()]), 2 * STARTING_CHIPS);
}

#[test]
fn bots_act_through_the_dealer() {
    let mut c = new_contract();
    at("owner.testnet", 1_500);
    c.create_house_table("Bots".into(), 5, 3, vec![BotStyle::Rock, BotStyle::Fish]);
    let mut a = Player::new(1);
    a.send(
        &mut c,
        json!({"do": "register", "name": "alice", "xpub": "aa".repeat(32)}),
        2_000,
    );
    let free = c
        .get_table(0)
        .unwrap()
        .seats
        .iter()
        .position(|s| s.is_none())
        .unwrap();
    a.send(
        &mut c,
        json!({"do": "sit", "table": 0, "seat": free, "buy_in": "1000"}),
        3_000,
    );
    assert_eq!(deal_job(&mut c, 0, 4_000), DealerTask::Deal);
    // Keep answering the dealer and calling/checking until the hand ends.
    let mut t = 5_000;
    for _ in 0..40 {
        let Some(hand) = c.get_table(0).unwrap().hand else {
            break;
        };
        if hand.pending.is_some() {
            deal_job(&mut c, 0, t);
        } else {
            let o = c.options(0).unwrap().1;
            let action = if o.can_check {
                json!({"kind": "check"})
            } else {
                json!({"kind": "call"})
            };
            act(&mut a, &mut c, action, t);
        }
        t += 1_000;
    }
    assert!(c.get_table(0).unwrap().hand.is_none(), "the hand finished");
    let rec = c.get_hand(0, U64(1)).unwrap();
    assert!(matches!(
        rec.outcome,
        Outcome::Showdown | Outcome::Uncontested
    ));
    assert_eq!(rec.hands.len(), 3);
}

#[test]
fn sat_out_players_can_sit_back_in() {
    let (mut c, mut a, _b) = setup_heads_up();
    deal_job(&mut c, 0, 5_000);
    {
        let seat = c.table_mut(0).seats[0].as_mut().unwrap();
        seat.sitting_out = true;
        seat.timeouts = 2;
    }
    a.send(&mut c, json!({"do": "sit_in", "table": 0}), 6_000);
    let seat = c.get_table(0).unwrap().seats[0].clone().unwrap();
    assert!(!seat.sitting_out);
    assert_eq!(seat.timeouts, 0);
}
