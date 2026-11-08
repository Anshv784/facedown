//! House bots. A bot is told only what a human in its seat would know: its
//! own two cards (taken from the deck here, inside the enclave) and the
//! public table state. It never looks at anyone else's cards or the rest of
//! the deck. Its sense of strength comes from a Monte Carlo estimate: deal
//! the cards it can't see at random many times and count how often it wins.
//!
//! The sampler is seeded from the hand's secret salt, so the same job always
//! gives the same move (an honest retry can't change a decision), and no one
//! outside the enclave can predict it.

use facedown_core::cards::{Card, DECK_SIZE};
use facedown_core::deck::{sha256, Layout};
use facedown_core::eval::evaluate;
use facedown_core::game::Street;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Style {
    /// "Rook": tight, rarely bluffs, bets big when strong.
    Rock,
    /// "Vega": aggressive, pressures with semi-bluffs.
    Shark,
    /// "Pip": loose, calls too much, the table's friendly donor.
    Fish,
}

#[derive(Deserialize)]
struct Spot {
    position: usize,
    style: Style,
    #[serde(default)]
    board: Vec<Card>,
    pot: u64,
    to_call: u64,
    can_check: bool,
    can_raise: bool,
    min_raise_to: u64,
    max_raise_to: u64,
    bet: u64,
    big_blind: u64,
    opponents: usize,
}

const SAMPLES: usize = 900;

/// A SHA-256 counter stream: plenty for sampling, and identical on every run.
struct Rng {
    seed: [u8; 32],
    counter: u64,
    buf: [u8; 32],
    used: usize,
}

impl Rng {
    fn new(seed: [u8; 32]) -> Self {
        Rng { seed, counter: 0, buf: [0; 32], used: 32 }
    }
    fn u32(&mut self) -> u32 {
        if self.used + 4 > 32 {
            let mut m = [0u8; 40];
            m[..32].copy_from_slice(&self.seed);
            m[32..].copy_from_slice(&self.counter.to_le_bytes());
            self.buf = sha256(&m);
            self.counter += 1;
            self.used = 0;
        }
        let v = u32::from_le_bytes(self.buf[self.used..self.used + 4].try_into().unwrap());
        self.used += 4;
        v
    }
    fn below(&mut self, n: usize) -> usize {
        // Rejection sampling keeps every index equally likely.
        let n = n as u32;
        let zone = u32::MAX - (u32::MAX % n);
        loop {
            let v = self.u32();
            if v < zone {
                return (v % n) as usize;
            }
        }
    }
    fn unit(&mut self) -> f64 {
        self.u32() as f64 / (u32::MAX as f64 + 1.0)
    }
}

/// Share of the pot this hand wins against `opponents` random hands,
/// counting split pots fractionally.
fn equity(hole: [Card; 2], board: &[Card], opponents: usize, rng: &mut Rng) -> f64 {
    let opponents = opponents.clamp(1, 5);
    let mut seen = [false; DECK_SIZE];
    for &c in hole.iter().chain(board) {
        seen[c as usize] = true;
    }
    let unseen: Vec<Card> = (0..DECK_SIZE as Card).filter(|&c| !seen[c as usize]).collect();
    let need = (5 - board.len()) + 2 * opponents;

    let mut won = 0.0;
    let mut pool = unseen.clone();
    let mut mine = Vec::with_capacity(7);
    let mut theirs = Vec::with_capacity(7);
    for _ in 0..SAMPLES {
        // Partial Fisher-Yates: the first `need` cards of `pool` are a fresh draw.
        for i in 0..need {
            let j = i + rng.below(pool.len() - i);
            pool.swap(i, j);
        }
        let (runout, others) = pool[..need].split_at(5 - board.len());
        mine.clear();
        mine.extend_from_slice(&hole);
        mine.extend_from_slice(board);
        mine.extend_from_slice(runout);
        let me = evaluate(&mine);

        let mut best_other = 0;
        let mut ties = 0usize;
        for o in others.chunks(2) {
            theirs.clear();
            theirs.extend_from_slice(o);
            theirs.extend_from_slice(board);
            theirs.extend_from_slice(runout);
            let s = evaluate(&theirs);
            if s > best_other {
                best_other = s;
                ties = 0;
            }
            if s == me {
                ties += 1;
            }
        }
        if me > best_other {
            won += 1.0;
        } else if me == best_other {
            won += 1.0 / (ties as f64 + 1.0);
        }
    }
    won / SAMPLES as f64
}

/// Chen-style preflop shortcut is unnecessary: the Monte Carlo above handles
/// preflop too (it simply samples all five board cards).
pub fn decide(rest: &Value, street: Street, layout: &Layout, salt: &[u8; 32]) -> Result<Value, String> {
    let spot: Spot = serde_json::from_value(rest.clone()).map_err(|e| format!("bad bot spot: {e}"))?;
    if spot.board.len() != street.board_len() {
        return Err("board does not match street".into());
    }
    let hole = layout.hole(spot.position);

    let mut seed_material = Vec::with_capacity(48);
    seed_material.extend_from_slice(b"facedown/bot/v1");
    seed_material.extend_from_slice(salt);
    seed_material.push(spot.position as u8);
    seed_material.push(street.board_len() as u8);
    seed_material.extend_from_slice(&spot.bet.to_le_bytes());
    seed_material.extend_from_slice(&spot.pot.to_le_bytes());
    let mut rng = Rng::new(sha256(&seed_material));

    let eq = equity(hole, &spot.board, spot.opponents, &mut rng);
    Ok(json!({ "action": choose(&spot, eq, &mut rng) }))
}

fn choose(s: &Spot, eq: f64, rng: &mut Rng) -> Value {
    let pot_after_call = (s.pot + s.to_call) as f64;
    let pot_odds = if s.to_call == 0 { 0.0 } else { s.to_call as f64 / pot_after_call };
    // What a fair share of the pot looks like with this many players.
    let fair = 1.0 / (s.opponents.max(1) as f64 + 1.0);
    let edge = eq - fair;
    let roll = rng.unit();

    let (value_raise, bluff_rate, call_margin, size) = match s.style {
        Style::Rock => (0.22, 0.03, 0.06, 0.75),
        Style::Shark => (0.12, 0.16, 0.0, 0.66),
        Style::Fish => (0.30, 0.02, -0.14, 0.5),
    };

    let raise_to = |frac: f64| -> Value {
        let target = s.bet + s.to_call + ((pot_after_call * frac) as u64).max(s.big_blind);
        let to = target.clamp(s.min_raise_to, s.max_raise_to);
        if to >= s.max_raise_to {
            json!({ "kind": "all_in" })
        } else {
            json!({ "kind": "raise", "to": to })
        }
    };
    let passive = || {
        if s.can_check {
            json!({ "kind": "check" })
        } else {
            json!({ "kind": "call" })
        }
    };

    // Monsters and clear value: raise (and size up with the nuts).
    if s.can_raise && edge > value_raise {
        let frac = if edge > value_raise + 0.25 { size * 1.4 } else { size };
        return raise_to(frac);
    }
    // Pressure: bluff or semi-bluff when nobody has shown strength yet.
    if s.can_raise && s.to_call <= s.big_blind && roll < bluff_rate && eq > fair * 0.6 {
        return raise_to(size * 0.8);
    }
    if s.can_check {
        return json!({ "kind": "check" });
    }
    // Price check: call when the odds are good enough for this style.
    if eq >= pot_odds + call_margin {
        return passive();
    }
    // Loose players peel cheap bets.
    if s.style == Style::Fish && s.to_call <= 2 * s.big_blind && roll < 0.5 {
        return passive();
    }
    json!({ "kind": "fold" })
}

#[cfg(test)]
mod tests {
    use super::*;
    use facedown_core::cards::parse;

    fn c(s: &str) -> Card {
        parse(s).unwrap()
    }

    #[test]
    fn aces_beat_a_random_hand_about_85_percent() {
        let mut rng = Rng::new([7; 32]);
        let e = equity([c("As"), c("Ah")], &[], 1, &mut rng);
        assert!((0.80..0.90).contains(&e), "{e}");
    }

    #[test]
    fn made_nuts_on_the_river_always_win() {
        let mut rng = Rng::new([1; 32]);
        let board = [c("Ks"), c("Qs"), c("Js"), c("2d"), c("3c")];
        let e = equity([c("As"), c("Ts")], &board, 3, &mut rng);
        assert_eq!(e, 1.0);
    }

    #[test]
    fn seven_deuce_is_weak_multiway() {
        let mut rng = Rng::new([3; 32]);
        let e = equity([c("7c"), c("2d")], &[], 4, &mut rng);
        assert!(e < 0.15, "{e}");
    }

    fn spot(style: Style, to_call: u64, can_check: bool) -> Spot {
        Spot {
            position: 0,
            style,
            board: vec![],
            pot: 300,
            to_call,
            can_check,
            can_raise: true,
            min_raise_to: 400,
            max_raise_to: 5000,
            bet: 0,
            big_blind: 100,
            opponents: 1,
        }
    }

    #[test]
    fn policies() {
        let mut rng = Rng::new([9; 32]);
        // Strong hand raises, legally sized.
        let a = choose(&spot(Style::Rock, 200, false), 0.9, &mut rng);
        assert_eq!(a["kind"], "raise");
        assert!(a["to"].as_u64().unwrap() >= 400);
        // Garbage facing a big bet folds.
        let a = choose(&spot(Style::Rock, 2000, false), 0.2, &mut rng);
        assert_eq!(a["kind"], "fold");
        // Never folds when it can check.
        let mut s = spot(Style::Rock, 0, true);
        s.can_raise = false;
        assert_eq!(choose(&s, 0.05, &mut rng)["kind"], "check");
        // Raising past the stack becomes all-in.
        let mut s = spot(Style::Shark, 200, false);
        s.max_raise_to = 450;
        assert_eq!(choose(&s, 0.95, &mut rng)["kind"], "all_in");
    }
}
