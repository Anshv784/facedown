//! Prints test vectors the browser port must reproduce exactly:
//! `cargo run -p facedown-core --example vectors > app/src/lib/vectors.json`
use facedown_core::deck::{deck_seed, salt_commitment, sha256, shuffle};
use facedown_core::eval::evaluate;

fn main() {
    let mut decks = vec![];
    for i in 0u8..6 {
        let vrf = sha256(&[b'v', i]);
        let salt = sha256(&[b's', i]);
        let deck = shuffle(deck_seed(&vrf, &salt));
        decks.push(format!(
            r#"{{"vrf":"{}","salt":"{}","commit":"{}","deck":{:?}}}"#,
            hex::encode(vrf), hex::encode(salt), hex::encode(salt_commitment(&salt)), deck.to_vec()
        ));
    }
    let mut hands = vec![];
    for i in 0u32..500 {
        // Seven distinct cards from a per-index shuffle.
        let deck = shuffle(sha256(&i.to_le_bytes()));
        let n = 5 + (i as usize % 3);
        let cards = &deck[..n];
        hands.push(format!(r#"{{"cards":{:?},"score":{}}}"#, cards.to_vec(), evaluate(cards)));
    }
    println!(r#"{{"decks":[{}],"hands":[{}]}}"#, decks.join(","), hands.join(","));
}
