//! The deck for a hand is a pure function of two 32-byte values:
//!
//! - `vrf_output`: OutLayer's verifiable random output. It can't be re-rolled,
//!   and the contract checks its proof, so nobody chooses the deck.
//! - `salt`: a secret only the dealer enclave knows during the hand. Its
//!   commitment goes on chain at the deal and the salt itself is revealed when
//!   the hand ends, so the deck stays hidden while cards are live and can't be
//!   swapped afterwards.
//!
//! The shuffle uses nothing but SHA-256 so the contract, the dealer and the
//! browser can all recompute exactly the same deck.

use sha2::{Digest, Sha256};

use crate::cards::{Card, DECK_SIZE};

pub const DECK_DOMAIN: &[u8] = b"facedown/deck/v1";
pub const SALT_DOMAIN: &[u8] = b"facedown/salt/v1";

pub fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

/// The seed the shuffle runs on.
pub fn deck_seed(vrf_output: &[u8; 32], salt: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(DECK_DOMAIN);
    h.update(vrf_output);
    h.update(salt);
    h.finalize().into()
}

/// What goes on chain at the deal, so the salt can't change later.
pub fn salt_commitment(salt: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(SALT_DOMAIN);
    h.update(salt);
    h.finalize().into()
}

/// A counter-mode stream: block `i` is `sha256(seed || i as u32 big-endian)`.
struct Stream {
    seed: [u8; 32],
    counter: u32,
    block: [u8; 32],
    pos: usize,
}

impl Stream {
    fn new(seed: [u8; 32]) -> Self {
        Self {
            seed,
            counter: 0,
            block: [0; 32],
            pos: 32,
        }
    }

    fn next_u32(&mut self) -> u32 {
        if self.pos == 32 {
            let mut h = Sha256::new();
            h.update(self.seed);
            h.update(self.counter.to_be_bytes());
            self.block = h.finalize().into();
            self.counter += 1;
            self.pos = 0;
        }
        let v = u32::from_be_bytes(self.block[self.pos..self.pos + 4].try_into().unwrap());
        self.pos += 4;
        v
    }

    /// Uniform in `0..n` by rejection sampling, so no index is favoured.
    fn below(&mut self, n: u32) -> u32 {
        let zone = (u32::MAX / n) * n;
        loop {
            let v = self.next_u32();
            if v < zone {
                return v % n;
            }
        }
    }
}

/// Fisher–Yates over `0..52`, driven by the stream.
pub fn shuffle(seed: [u8; 32]) -> [Card; DECK_SIZE] {
    let mut deck = [0u8; DECK_SIZE];
    for (i, c) in deck.iter_mut().enumerate() {
        *c = i as Card;
    }
    let mut stream = Stream::new(seed);
    for i in (1..DECK_SIZE).rev() {
        let j = stream.below(i as u32 + 1) as usize;
        deck.swap(i, j);
    }
    deck
}

/// Where each card comes from. With `n` players dealt in (in seat order), the
/// player at position `j` gets `deck[2j]` and `deck[2j + 1]`, and the board
/// is the next five: flop `2n..2n+3`, turn `2n+3`, river `2n+4`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Layout {
    pub deck: [Card; DECK_SIZE],
    pub players: usize,
}

impl Layout {
    pub fn new(vrf_output: &[u8; 32], salt: &[u8; 32], players: usize) -> Self {
        assert!((2..=10).contains(&players), "2 to 10 players");
        Self {
            deck: shuffle(deck_seed(vrf_output, salt)),
            players,
        }
    }

    pub fn hole(&self, position: usize) -> [Card; 2] {
        [self.deck[2 * position], self.deck[2 * position + 1]]
    }

    pub fn board(&self) -> [Card; 5] {
        let b = 2 * self.players;
        [
            self.deck[b],
            self.deck[b + 1],
            self.deck[b + 2],
            self.deck[b + 3],
            self.deck[b + 4],
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_shuffle_is_a_permutation_and_deterministic() {
        let seed = deck_seed(&[7; 32], &[9; 32]);
        let a = shuffle(seed);
        assert_eq!(a, shuffle(seed));
        let mut sorted = a;
        sorted.sort();
        assert_eq!(sorted.to_vec(), (0..52).collect::<alloc::vec::Vec<u8>>());
        assert_ne!(
            a,
            shuffle(deck_seed(&[7; 32], &[8; 32])),
            "a different salt gives a different deck"
        );
    }

    #[test]
    fn cards_never_repeat_across_holes_and_board() {
        let layout = Layout::new(&[1; 32], &[2; 32], 6);
        let mut seen = alloc::vec::Vec::new();
        for p in 0..6 {
            seen.extend(layout.hole(p));
        }
        seen.extend(layout.board());
        let n = seen.len();
        seen.sort();
        seen.dedup();
        assert_eq!(seen.len(), n);
    }

    #[test]
    fn positions_are_roughly_uniform() {
        // Where does card 0 land over many decks? Each of 52 slots ~ 1/52.
        let mut counts = [0u32; 52];
        for i in 0..5200u32 {
            let mut seed = [0u8; 32];
            seed[..4].copy_from_slice(&i.to_be_bytes());
            let deck = shuffle(seed);
            counts[deck.iter().position(|&c| c == 0).unwrap()] += 1;
        }
        // Expected 100 per slot; a fair shuffle stays well inside 40..160.
        assert!(counts.iter().all(|&c| (40..160).contains(&c)), "{counts:?}");
    }

    /// Pinned vector, mirrored by the browser verifier's tests.
    #[test]
    fn known_vector() {
        let deck = shuffle(deck_seed(&[0x11; 32], &[0x22; 32]));
        assert_eq!(&deck[..5], &KNOWN_FIRST_FIVE);
    }

    const KNOWN_FIRST_FIVE: [u8; 5] = [16, 45, 3, 9, 37];
}
