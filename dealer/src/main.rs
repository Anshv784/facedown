//! The Facedown dealer. Runs inside an OutLayer TDX enclave as the project
//! the table contract calls; it answers four jobs:
//!
//! - `deal`: draws OutLayer's VRF output for this hand, derives the hand's
//!   secret salt, commits to it, shuffles, and seals each player's two hole
//!   cards to that player's x25519 key. Nothing else leaves the enclave.
//! - `board`: re-derives the same deck and reveals one street's cards.
//! - `finish`: reveals the salt, so the contract (and anyone) can rebuild
//!   and audit the whole deck.
//! - `bot`: plays a house bot. The bot is shown only its own two cards and
//!   the public board; its odds come from sampling every card it can't see.
//!
//! The salt is `HMAC-SHA256(DEALER_KEY, contract | table | hand | vrf)`,
//! where `PROTECTED_DEALER_KEY` is generated inside the enclave and bound to
//! this build's hash, so no one ever sees it and a different build can't
//! read it. Only the table contract named in the secrets may call this.

mod bot;

use std::io::{self, Read, Write};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use facedown_core::cards::Card;
use facedown_core::deck::{salt_commitment, sha256, Layout};
use facedown_core::game::Street;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use x25519_dalek::{PublicKey, StaticSecret};

type HmacSha256 = Hmac<sha2::Sha256>;

#[derive(Deserialize)]
struct Job {
    op: String,
    table: u32,
    hand: u64,
    players: usize,
    #[serde(default)]
    seed: String,
    #[serde(default)]
    seats: Vec<Seat>,
    #[serde(default)]
    vrf: String,
    street: Option<Street>,
    #[serde(flatten)]
    rest: Value,
}

#[derive(Deserialize)]
struct Seat {
    position: usize,
    xpub: String,
}

fn main() {
    let out = run().unwrap_or_else(|e| json!({ "error": e }));
    print!("{out}");
    io::stdout().flush().ok();
}

fn run() -> Result<Value, String> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).map_err(|e| format!("cannot read input: {e}"))?;
    let contract = std::env::var("FACEDOWN_CONTRACT").map_err(|_| "FACEDOWN_CONTRACT secret missing")?;
    let caller = outlayer::env::predecessor_account_id().unwrap_or_default();
    let key = std::env::var("PROTECTED_DEALER_KEY").map_err(|_| "PROTECTED_DEALER_KEY secret missing")?;
    handle(&input, &contract, &caller, &key)
}

/// One job, given the request and what OutLayer told us about it.
fn handle(input: &str, contract: &str, caller: &str, key_hex: &str) -> Result<Value, String> {
    // Only the table contract may ask. OutLayer releases secrets based on the
    // project, not the caller, so this check is what keeps a stranger from
    // asking the dealer to reveal a live hand's board or salt.
    if caller != contract {
        return Err(format!("called by {caller:?}, not by {contract}"));
    }
    let key = hex::decode(key_hex).map_err(|_| "PROTECTED_DEALER_KEY is not hex")?;
    if key.len() < 32 {
        return Err("PROTECTED_DEALER_KEY is too short".into());
    }
    let job: Job = serde_json::from_str(input).map_err(|e| format!("bad input: {e}"))?;
    let (contract, key) = (contract.to_string(), key);
    if !(2..=6).contains(&job.players) {
        return Err("2 to 6 players".into());
    }

    match job.op.as_str() {
        "deal" => deal(&job, &contract, &key),
        "board" => {
            let (salt, vrf) = salt_for(&job, &contract, &key)?;
            let layout = Layout::new(&vrf, &salt, job.players);
            let street = job.street.ok_or("street missing")?;
            let board = layout.board();
            let cards: Vec<Card> = match street {
                Street::Flop => board[..3].to_vec(),
                Street::Turn => board[3..4].to_vec(),
                Street::River => board[4..5].to_vec(),
                Street::Preflop => return Err("no board preflop".into()),
            };
            Ok(json!({ "cards": cards }))
        }
        "finish" => {
            let (salt, _) = salt_for(&job, &contract, &key)?;
            Ok(json!({ "salt": hex::encode(salt) }))
        }
        "bot" => {
            let (salt, vrf) = salt_for(&job, &contract, &key)?;
            let layout = Layout::new(&vrf, &salt, job.players);
            bot::decide(&job.rest, job.street.ok_or("street missing")?, &layout, &salt)
        }
        other => Err(format!("unknown op {other}")),
    }
}

fn salt_for(job: &Job, contract: &str, key: &[u8]) -> Result<([u8; 32], [u8; 32]), String> {
    let vrf: [u8; 32] = hex::decode(&job.vrf)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or("vrf output missing or malformed")?;
    Ok((salt_from(key, contract, job.table, job.hand, &vrf)?, vrf))
}

/// The hand's secret salt. Deterministic, so `board`, `finish` and `bot`
/// jobs re-derive exactly the deck `deal` used, with nothing stored.
pub fn salt_from(key: &[u8], contract: &str, table: u32, hand: u64, vrf: &[u8; 32]) -> Result<[u8; 32], String> {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key).map_err(|_| "bad dealer key")?;
    mac.update(format!("facedown/salt/v1|{contract}|{table}|{hand}|").as_bytes());
    mac.update(vrf);
    Ok(mac.finalize().into_bytes().into())
}

fn deal(job: &Job, contract: &str, key: &[u8]) -> Result<Value, String> {
    if job.seed.is_empty() || job.seed.contains(':') {
        return Err("bad seed".into());
    }
    if job.seats.len() != job.players {
        return Err("one seat entry per player".into());
    }
    let vrf = outlayer::vrf::random(&job.seed)?;
    let vrf_out: [u8; 32] = hex::decode(&vrf.output_hex)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or("VRF output is not 32 bytes")?;
    let salt = salt_from(key, contract, job.table, job.hand, &vrf_out)?;
    let layout = Layout::new(&vrf_out, &salt, job.players);

    let mut holes = Vec::new();
    for seat in &job.seats {
        if seat.position >= job.players {
            return Err("seat position out of range".into());
        }
        if seat.xpub.is_empty() {
            continue; // a house bot: its cards never leave the enclave
        }
        let xpub: [u8; 32] = hex::decode(&seat.xpub)
            .ok()
            .and_then(|v| v.try_into().ok())
            .ok_or("player key is not 32 bytes of hex")?;
        let aad = hole_aad(contract, job.table, job.hand, seat.position);
        let (epk, ct) = seal(layout.hole(seat.position), &xpub, &aad)?;
        holes.push(json!({ "position": seat.position, "epk": epk, "ct": ct }));
    }
    Ok(json!({
        "vrf": { "output": vrf.output_hex, "signature": vrf.signature_hex, "alpha": vrf.alpha },
        "salt_commit": hex::encode(salt_commitment(&salt)),
        "holes": holes,
    }))
}

/// Seals two cards to a player's x25519 key: an ephemeral key per message,
/// key = SHA-256(domain | shared | epk | xpub), ChaCha20-Poly1305 with a zero
/// nonce (the key is single-use) and the hand's coordinates as associated data.
pub fn seal(cards: [Card; 2], xpub: &[u8; 32], aad: &str) -> Result<(String, String), String> {
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).map_err(|e| format!("no randomness: {e}"))?;
    let secret = StaticSecret::from(seed);
    let epk = PublicKey::from(&secret);
    let shared = secret.diffie_hellman(&PublicKey::from(*xpub));
    let mut material = Vec::with_capacity(128);
    material.extend_from_slice(b"facedown/hole/v1");
    material.extend_from_slice(shared.as_bytes());
    material.extend_from_slice(epk.as_bytes());
    material.extend_from_slice(xpub);
    let k = sha256(&material);
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&k));
    let ct = cipher
        .encrypt(Nonce::from_slice(&[0u8; 12]), Payload { msg: &cards, aad: aad.as_bytes() })
        .map_err(|_| "encryption failed")?;
    Ok((hex::encode(epk.as_bytes()), hex::encode(ct)))
}

pub fn hole_aad(contract: &str, table: u32, hand: u64, position: usize) -> String {
    format!("facedown/{contract}/{table}/{hand}/{position}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What the browser does: x25519 with its secret, same key derivation.
    fn open(secret: &StaticSecret, epk_hex: &str, ct_hex: &str, aad: &str) -> Option<Vec<u8>> {
        let epk: [u8; 32] = hex::decode(epk_hex).ok()?.try_into().ok()?;
        let xpub = PublicKey::from(secret);
        let shared = secret.diffie_hellman(&PublicKey::from(epk));
        let mut m = Vec::new();
        m.extend_from_slice(b"facedown/hole/v1");
        m.extend_from_slice(shared.as_bytes());
        m.extend_from_slice(&epk);
        m.extend_from_slice(xpub.as_bytes());
        let k = sha256(&m);
        ChaCha20Poly1305::new(Key::from_slice(&k))
            .decrypt(Nonce::from_slice(&[0u8; 12]), Payload { msg: &hex::decode(ct_hex).ok()?, aad: aad.as_bytes() })
            .ok()
    }

    #[test]
    fn sealed_cards_open_only_for_their_owner_and_hand() {
        let me = StaticSecret::from([5u8; 32]);
        let xpub = PublicKey::from(&me).to_bytes();
        let aad = hole_aad("t.testnet", 0, 7, 1);
        let (epk, ct) = seal([12, 51], &xpub, &aad).unwrap();
        assert_eq!(open(&me, &epk, &ct, &aad), Some(vec![12, 51]));
        // Another hand's coordinates don't open it, nor does another key.
        assert_eq!(open(&me, &epk, &ct, &hole_aad("t.testnet", 0, 8, 1)), None);
        assert_eq!(open(&StaticSecret::from([6u8; 32]), &epk, &ct, &aad), None);
    }

    const C: &str = "facedown.anshv784.testnet";
    const K: &str = "0707070707070707070707070707070707070707070707070707070707070707";

    fn job(extra: &str) -> String {
        format!(r#"{{"table":0,"hand":1,"players":3,"vrf":"{}",{extra}}}"#, "ab".repeat(32))
    }

    #[test]
    fn jobs_reveal_one_consistent_deck() {
        let flop = handle(&job(r#""op":"board","street":"flop""#), C, C, K).unwrap();
        let turn = handle(&job(r#""op":"board","street":"turn""#), C, C, K).unwrap();
        let river = handle(&job(r#""op":"board","street":"river""#), C, C, K).unwrap();
        let salt = handle(&job(r#""op":"finish""#), C, C, K).unwrap();

        // Rebuild the deck from the revealed salt, as the contract audit does.
        let salt: [u8; 32] = hex::decode(salt["salt"].as_str().unwrap()).unwrap().try_into().unwrap();
        let layout = Layout::new(&[0xab; 32], &salt, 3);
        let mut shown: Vec<u64> = flop["cards"].as_array().unwrap().iter().map(|c| c.as_u64().unwrap()).collect();
        shown.push(turn["cards"][0].as_u64().unwrap());
        shown.push(river["cards"][0].as_u64().unwrap());
        assert_eq!(shown, layout.board().iter().map(|&c| c as u64).collect::<Vec<_>>());
    }

    #[test]
    fn strangers_and_bad_jobs_are_refused() {
        let finish = job(r#""op":"finish""#);
        assert!(handle(&finish, C, "mallory.testnet", K).unwrap_err().contains("not by"));
        assert!(handle(&job(r#""op":"board","street":"preflop""#), C, C, K).is_err());
        assert!(handle(&job(r#""op":"steal""#), C, C, K).is_err());
        assert!(handle(&finish, C, C, "07").is_err());
    }

    #[test]
    fn bots_answer_with_a_move() {
        let spot = r#""op":"bot","position":2,"style":"shark","street":"flop","board":[1,2,3],"pot":300,"to_call":0,"can_check":true,"can_raise":true,"min_raise_to":100,"max_raise_to":5000,"bet":0,"big_blind":100,"opponents":2"#;
        let a = handle(&job(spot), C, C, K).unwrap();
        let kind = a["action"]["kind"].as_str().unwrap();
        assert!(["check", "raise", "all_in"].contains(&kind), "{a}");
        // The same job always gives the same move.
        assert_eq!(a, handle(&job(spot), C, C, K).unwrap());
        // A board that doesn't fit the street is refused.
        assert!(handle(&job(&spot.replace("[1,2,3]", "[1,2]")), C, C, K).is_err());
    }

    /// Writes a sealed-hand vector for the browser's decryption test.
    #[test]
    #[ignore]
    fn print_seal_vector() {
        let me = StaticSecret::from([5u8; 32]);
        let aad = hole_aad("facedown.testnet", 3, 41, 2);
        let (epk, ct) = seal([12, 51], &PublicKey::from(&me).to_bytes(), &aad).unwrap();
        println!(r#"SEAL {{"box":"{}","table":3,"hand":"41","position":2,"epk":"{epk}","ct":"{ct}","cards":[12,51]}}"#, "05".repeat(32));
    }

    #[test]
    fn salt_is_bound_to_the_hand() {
        let k = [9u8; 32];
        let v = [1u8; 32];
        let a = salt_from(&k, "c", 0, 1, &v).unwrap();
        assert_eq!(a, salt_from(&k, "c", 0, 1, &v).unwrap());
        assert_ne!(a, salt_from(&k, "c", 0, 2, &v).unwrap());
        assert_ne!(a, salt_from(&k, "d", 0, 1, &v).unwrap());
        assert_ne!(a, salt_from(&[8u8; 32], "c", 0, 1, &v).unwrap());
    }
}
