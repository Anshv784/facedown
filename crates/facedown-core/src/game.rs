//! No-limit Texas Hold'em betting for one hand, independent of cards.
//!
//! Players are listed in seat order; index `j` here is also the deck position
//! `j` in [`crate::deck::Layout`]. Amounts are whole chips.
//!
//! Rules implemented: blinds (heads-up: the button posts the small blind and
//! acts first preflop, last after), check / call / bet-raise / all-in, the
//! minimum raise equal to the last full raise (at least the big blind), a
//! short all-in that does not reopen raising for players who already acted,
//! run-outs when no more betting is possible, and side pots at showdown with
//! ties split and odd chips going to the first winner left of the button.

use alloc::vec::Vec;
use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

#[derive(
    BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq,
)]
#[serde(rename_all = "snake_case")]
pub enum Street {
    Preflop,
    Flop,
    Turn,
    River,
}

impl Street {
    pub fn next(self) -> Option<Street> {
        match self {
            Street::Preflop => Some(Street::Flop),
            Street::Flop => Some(Street::Turn),
            Street::Turn => Some(Street::River),
            Street::River => None,
        }
    }

    /// Board cards visible once this street has been dealt.
    pub fn board_len(self) -> usize {
        match self {
            Street::Preflop => 0,
            Street::Flop => 3,
            Street::Turn => 4,
            Street::River => 5,
        }
    }
}

#[derive(
    BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq,
)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    Fold,
    Check,
    Call,
    /// Bet or raise so this street's total bet becomes `to`.
    Raise {
        to: u64,
    },
    AllIn,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Player {
    pub seat: u8,
    pub stack: u64,
    /// Chips put in on this street.
    pub bet: u64,
    /// Chips put in over the whole hand.
    pub total: u64,
    pub folded: bool,
    pub all_in: bool,
    /// Has acted since the last full raise.
    pub acted: bool,
    /// May still raise (false after a short all-in when this player had acted).
    pub can_raise: bool,
}

impl Player {
    fn live(&self) -> bool {
        !self.folded
    }
    fn can_act(&self) -> bool {
        !self.folded && !self.all_in
    }
}

/// What the table should do next.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Progress {
    /// Waiting for this player.
    ToAct { player: usize },
    /// The street is closed: deal it, then call [`Betting::start_street`].
    Deal { street: Street },
    /// No more betting can happen: deal the rest of the board, then show down.
    RunOut,
    /// Betting is over after the river.
    Showdown,
    /// Everyone else folded.
    Uncontested { winner: usize },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BetError {
    NotYourTurn,
    HandOver,
    CannotCheck,
    NothingToCall,
    CannotRaise,
    RaiseTooSmall,
    NotEnoughChips,
}

impl BetError {
    pub fn as_str(self) -> &'static str {
        match self {
            BetError::NotYourTurn => "not your turn",
            BetError::HandOver => "betting is over",
            BetError::CannotCheck => "you can't check: there is a bet to call",
            BetError::NothingToCall => "nothing to call",
            BetError::CannotRaise => "raising is closed for you this round",
            BetError::RaiseTooSmall => "raise is below the minimum",
            BetError::NotEnoughChips => "not enough chips",
        }
    }
}

/// What a player may do right now.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Options {
    pub to_call: u64,
    pub can_check: bool,
    pub can_raise: bool,
    pub min_raise_to: u64,
    pub max_raise_to: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Betting {
    pub players: Vec<Player>,
    /// Index of the button in `players`.
    pub button: usize,
    pub small_blind: u64,
    pub big_blind: u64,
    pub street: Street,
    pub to_act: Option<usize>,
    pub current_bet: u64,
    pub min_raise: u64,
}

impl Betting {
    /// Starts a hand: `stacks` are `(seat, chips)` in seat order, every stack > 0.
    pub fn new(stacks: &[(u8, u64)], button: usize, small_blind: u64, big_blind: u64) -> Self {
        let n = stacks.len();
        assert!(n >= 2, "at least two players");
        assert!(button < n, "button out of range");
        assert!(
            stacks.iter().all(|&(_, s)| s > 0),
            "every stack must be positive"
        );
        assert!(small_blind > 0 && big_blind >= small_blind, "bad blinds");
        let players = stacks
            .iter()
            .map(|&(seat, stack)| Player {
                seat,
                stack,
                bet: 0,
                total: 0,
                folded: false,
                all_in: false,
                acted: false,
                can_raise: true,
            })
            .collect();
        let mut b = Betting {
            players,
            button,
            small_blind,
            big_blind,
            street: Street::Preflop,
            to_act: None,
            current_bet: 0,
            min_raise: big_blind,
        };
        let (sb, bb) = b.blind_positions();
        b.put(sb, small_blind);
        b.put(bb, big_blind);
        b.current_bet = big_blind;
        b.to_act = b.next_to_act_after(bb);
        b
    }

    /// `(small blind, big blind)` indices.
    pub fn blind_positions(&self) -> (usize, usize) {
        let n = self.players.len();
        if n == 2 {
            (self.button, (self.button + 1) % n)
        } else {
            ((self.button + 1) % n, (self.button + 2) % n)
        }
    }

    fn put(&mut self, i: usize, amount: u64) {
        let p = &mut self.players[i];
        let amount = amount.min(p.stack);
        p.stack -= amount;
        p.bet += amount;
        p.total += amount;
        if p.stack == 0 {
            p.all_in = true;
        }
    }

    pub fn pot(&self) -> u64 {
        self.players.iter().map(|p| p.total).sum()
    }

    pub fn options(&self, i: usize) -> Options {
        let p = &self.players[i];
        let to_call = self.current_bet.saturating_sub(p.bet).min(p.stack);
        let max_raise_to = p.bet + p.stack;
        Options {
            to_call,
            can_check: self.current_bet <= p.bet,
            can_raise: p.can_raise && max_raise_to > self.current_bet,
            min_raise_to: (self.current_bet + self.min_raise).min(max_raise_to),
            max_raise_to,
        }
    }

    /// The action a timed-out player takes: check if free, otherwise fold.
    pub fn timeout_action(&self, i: usize) -> Action {
        if self.options(i).can_check {
            Action::Check
        } else {
            Action::Fold
        }
    }

    pub fn act(&mut self, i: usize, action: Action) -> Result<Progress, BetError> {
        if self.to_act.is_none() {
            return Err(BetError::HandOver);
        }
        if self.to_act != Some(i) {
            return Err(BetError::NotYourTurn);
        }
        let opts = self.options(i);
        match action {
            Action::Fold => self.players[i].folded = true,
            Action::Check => {
                if !opts.can_check {
                    return Err(BetError::CannotCheck);
                }
            }
            Action::Call => {
                if opts.to_call == 0 {
                    return Err(BetError::NothingToCall);
                }
                self.put(i, opts.to_call);
            }
            Action::Raise { to } => {
                if !opts.can_raise {
                    return Err(BetError::CannotRaise);
                }
                if to > opts.max_raise_to {
                    return Err(BetError::NotEnoughChips);
                }
                // Anything short of the minimum is only allowed as an all-in.
                if to < self.current_bet + self.min_raise && to != opts.max_raise_to {
                    return Err(BetError::RaiseTooSmall);
                }
                self.raise_to(i, to);
            }
            Action::AllIn => {
                let to = opts.max_raise_to;
                if to <= self.current_bet {
                    self.put(i, opts.to_call); // an all-in call
                } else if !opts.can_raise {
                    // May only call: put in what calling costs.
                    self.put(i, opts.to_call);
                } else {
                    self.raise_to(i, to);
                }
            }
        }
        self.players[i].acted = true;
        Ok(self.after_action(i))
    }

    fn raise_to(&mut self, i: usize, to: u64) {
        let previous_bet = self.current_bet;
        let increment = to - previous_bet;
        let add = to - self.players[i].bet;
        self.put(i, add);
        self.current_bet = to;
        let full = increment >= self.min_raise;
        if full {
            self.min_raise = increment;
        }
        for (j, p) in self.players.iter_mut().enumerate() {
            if j == i || !p.can_act() {
                continue;
            }
            if !full && p.acted && p.bet == previous_bet {
                // Facing a short all-in after acting: may call or fold only.
                p.can_raise = false;
            } else if full {
                p.can_raise = true;
            }
            p.acted = false;
        }
    }

    fn live_count(&self) -> usize {
        self.players.iter().filter(|p| p.live()).count()
    }

    fn actors(&self) -> usize {
        self.players.iter().filter(|p| p.can_act()).count()
    }

    fn needs_action(&self, p: &Player) -> bool {
        p.can_act() && (!p.acted || p.bet < self.current_bet)
    }

    fn next_to_act_after(&self, i: usize) -> Option<usize> {
        let n = self.players.len();
        (1..=n)
            .map(|k| (i + k) % n)
            .find(|&j| self.needs_action(&self.players[j]))
    }

    fn after_action(&mut self, i: usize) -> Progress {
        if self.live_count() == 1 {
            self.to_act = None;
            let winner = self.players.iter().position(|p| p.live()).unwrap();
            return Progress::Uncontested { winner };
        }
        if let Some(next) = self.next_to_act_after(i) {
            // A lone player with chips left facing nobody who can respond
            // still has to call or fold the all-in in front of them.
            self.to_act = Some(next);
            return Progress::ToAct { player: next };
        }
        self.to_act = None;
        self.street_closed()
    }

    fn street_closed(&self) -> Progress {
        if self.actors() <= 1 {
            return if self.street == Street::River {
                Progress::Showdown
            } else {
                Progress::RunOut
            };
        }
        match self.street.next() {
            Some(street) => Progress::Deal { street },
            None => Progress::Showdown,
        }
    }

    /// Opens betting on `street` once its cards are out.
    pub fn start_street(&mut self, street: Street) -> Progress {
        self.street = street;
        self.current_bet = 0;
        self.min_raise = self.big_blind;
        for p in self.players.iter_mut() {
            p.bet = 0;
            p.acted = false;
            p.can_raise = true;
        }
        if self.actors() <= 1 {
            self.to_act = None;
            return self.street_closed();
        }
        // Postflop the first player left of the button speaks (heads-up: the big blind).
        self.to_act = self.next_to_act_after(self.button);
        Progress::ToAct {
            player: self.to_act.unwrap(),
        }
    }

    /// What each player receives. `scores[i]` is the hand score of player `i`
    /// (ignored for folded players). Side pots are built from each player's
    /// total contribution; every chip goes back out.
    pub fn payouts(&self, scores: &[u32]) -> Vec<u64> {
        let n = self.players.len();
        let mut out = alloc::vec![0u64; n];
        if self.live_count() == 1 {
            let w = self.players.iter().position(|p| p.live()).unwrap();
            out[w] = self.pot();
            return out;
        }
        let mut levels: Vec<u64> = self
            .players
            .iter()
            .map(|p| p.total)
            .filter(|&t| t > 0)
            .collect();
        levels.sort_unstable();
        levels.dedup();
        let mut prev = 0;
        for level in levels {
            let amount: u64 = self
                .players
                .iter()
                .map(|p| p.total.min(level) - p.total.min(prev))
                .sum();
            prev = level;
            if amount == 0 {
                continue;
            }
            let eligible: Vec<usize> = (0..n)
                .filter(|&i| self.players[i].live() && self.players[i].total >= level)
                .collect();
            // Folded chips above every live stack go to the deepest live player.
            let eligible = if eligible.is_empty() {
                let best = (0..n)
                    .filter(|&i| self.players[i].live())
                    .max_by_key(|&i| self.players[i].total)
                    .unwrap();
                alloc::vec![best]
            } else {
                eligible
            };
            let top = eligible.iter().map(|&i| scores[i]).max().unwrap();
            // Winners in order starting left of the button, for the odd chips.
            let winners: Vec<usize> = (1..=n)
                .map(|k| (self.button + k) % n)
                .filter(|i| eligible.contains(i) && scores[*i] == top)
                .collect();
            let share = amount / winners.len() as u64;
            let mut odd = amount % winners.len() as u64;
            for &w in &winners {
                out[w] += share;
                if odd > 0 {
                    out[w] += 1;
                    odd -= 1;
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(stacks: &[u64], button: usize) -> Betting {
        let s: Vec<(u8, u64)> = stacks
            .iter()
            .enumerate()
            .map(|(i, &c)| (i as u8, c))
            .collect();
        Betting::new(&s, button, 5, 10)
    }

    #[test]
    fn heads_up_blinds_and_order() {
        let mut b = table(&[1000, 1000], 0);
        // Button posts the small blind and acts first preflop.
        assert_eq!((b.players[0].bet, b.players[1].bet), (5, 10));
        assert_eq!(b.to_act, Some(0));
        assert_eq!(b.act(0, Action::Call), Ok(Progress::ToAct { player: 1 }));
        assert_eq!(
            b.act(1, Action::Check),
            Ok(Progress::Deal {
                street: Street::Flop
            })
        );
        // After the flop the big blind (non-button) acts first.
        assert_eq!(b.start_street(Street::Flop), Progress::ToAct { player: 1 });
        assert_eq!(b.pot(), 20);
    }

    #[test]
    fn three_handed_order_and_raise_reopens() {
        let mut b = table(&[1000, 1000, 1000], 0);
        // SB = 1, BB = 2, UTG = button (0) acts first.
        assert_eq!(b.to_act, Some(0));
        assert_eq!(
            b.act(0, Action::Raise { to: 30 }),
            Ok(Progress::ToAct { player: 1 })
        );
        assert_eq!(b.act(1, Action::Fold), Ok(Progress::ToAct { player: 2 }));
        assert_eq!(
            b.act(2, Action::Raise { to: 90 }),
            Ok(Progress::ToAct { player: 0 })
        );
        // Min re-raise is 90 + 60.
        assert_eq!(b.options(0).min_raise_to, 150);
        assert_eq!(
            b.act(0, Action::Raise { to: 120 }),
            Err(BetError::RaiseTooSmall)
        );
        assert_eq!(
            b.act(0, Action::Call),
            Ok(Progress::Deal {
                street: Street::Flop
            })
        );
        assert_eq!(b.pot(), 5 + 90 + 90);
    }

    #[test]
    fn wrong_turn_and_illegal_moves() {
        let mut b = table(&[1000, 1000, 1000], 0);
        assert_eq!(b.act(1, Action::Call), Err(BetError::NotYourTurn));
        assert_eq!(b.act(0, Action::Check), Err(BetError::CannotCheck));
        assert_eq!(
            b.act(0, Action::Raise { to: 5000 }),
            Err(BetError::NotEnoughChips)
        );
    }

    #[test]
    fn everyone_folds_to_the_raiser() {
        let mut b = table(&[1000, 1000, 1000], 0);
        b.act(0, Action::Raise { to: 40 }).unwrap();
        b.act(1, Action::Fold).unwrap();
        assert_eq!(
            b.act(2, Action::Fold),
            Ok(Progress::Uncontested { winner: 0 })
        );
        assert_eq!(b.payouts(&[0, 0, 0]), alloc::vec![55, 0, 0]);
    }

    #[test]
    fn short_all_in_does_not_reopen_raising() {
        // P0 opens to 100; P1 has only 150 and shoves (a 50 raise, short of 90).
        let mut b = table(&[1000, 150, 1000], 2);
        // button 2 → SB 0, BB 1, first to act is 2.
        assert_eq!(b.to_act, Some(2));
        b.act(2, Action::Raise { to: 100 }).unwrap();
        b.act(0, Action::Fold).unwrap();
        assert_eq!(b.act(1, Action::AllIn), Ok(Progress::ToAct { player: 2 }));
        let o = b.options(2);
        assert!(!o.can_raise, "the opener may only call or fold");
        assert_eq!(o.to_call, 50);
        assert_eq!(
            b.act(2, Action::Raise { to: 400 }),
            Err(BetError::CannotRaise)
        );
        // Calling closes the street, and with one actor left it runs out.
        assert_eq!(b.act(2, Action::Call), Ok(Progress::RunOut));
    }

    #[test]
    fn all_in_preflop_runs_out() {
        let mut b = table(&[300, 1000], 0);
        assert_eq!(b.act(0, Action::AllIn), Ok(Progress::ToAct { player: 1 }));
        assert_eq!(b.act(1, Action::Call), Ok(Progress::RunOut));
        assert_eq!(b.pot(), 600);
        // The covered player can't win more than they put in.
        assert_eq!(b.payouts(&[9, 1]), alloc::vec![600, 0]);
        assert_eq!(b.payouts(&[1, 9]), alloc::vec![0, 600]);
    }

    #[test]
    fn side_pots_three_way() {
        // P0 all-in 100, P1 all-in 300, P2 covers with 1000.
        let mut b = table(&[100, 300, 1000], 2);
        // SB 0 (posts 5), BB 1 (posts 10), first to act 2.
        b.act(2, Action::Raise { to: 300 }).unwrap();
        b.act(0, Action::AllIn).unwrap();
        assert_eq!(b.act(1, Action::AllIn), Ok(Progress::RunOut));
        assert_eq!(b.pot(), 100 + 300 + 300);
        // Short stack has the best hand: wins the main pot (3 x 100);
        // P1 beats P2: wins the side pot (2 x 200).
        assert_eq!(b.payouts(&[30, 20, 10]), alloc::vec![300, 400, 0]);
        // P2 best: takes everything.
        assert_eq!(b.payouts(&[10, 20, 30]), alloc::vec![0, 0, 700]);
    }

    #[test]
    fn split_pot_odd_chip_goes_left_of_button() {
        let mut b = table(&[1000, 1000, 1000], 0);
        b.act(0, Action::Call).unwrap();
        b.act(1, Action::Fold).unwrap(); // SB folds its 5
        b.act(2, Action::Check).unwrap();
        // Pot 25 between P0 and P2 tied: 12 each + odd chip to P2? Left of
        // button (0) is 1 (folded), then 2 → P2 gets the odd chip.
        assert_eq!(b.payouts(&[7, 0, 7]), alloc::vec![12, 0, 13]);
    }

    #[test]
    fn full_hand_to_showdown() {
        let mut b = table(&[1000, 1000], 1);
        b.act(1, Action::Call).unwrap();
        assert_eq!(
            b.act(0, Action::Check),
            Ok(Progress::Deal {
                street: Street::Flop
            })
        );
        for street in [Street::Flop, Street::Turn, Street::River] {
            let first = match b.start_street(street) {
                Progress::ToAct { player } => player,
                p => panic!("{p:?}"),
            };
            b.act(first, Action::Check).unwrap();
            let r = b.act(1 - first, Action::Check).unwrap();
            if street == Street::River {
                assert_eq!(r, Progress::Showdown);
            }
        }
        assert_eq!(b.payouts(&[5, 5]), alloc::vec![10, 10]);
    }

    #[test]
    fn timeout_checks_when_free_else_folds() {
        let mut b = table(&[1000, 1000], 0);
        assert_eq!(b.timeout_action(0), Action::Fold);
        b.act(0, Action::Call).unwrap();
        assert_eq!(b.timeout_action(1), Action::Check);
    }

    #[test]
    fn chips_are_conserved() {
        let mut b = table(&[100, 300, 1000, 50], 0);
        // UTG is 3 (left of BB 2): shove 50; button 0 shoves 100; SB 1 shoves 300; BB calls.
        b.act(3, Action::AllIn).unwrap();
        b.act(0, Action::AllIn).unwrap();
        b.act(1, Action::AllIn).unwrap();
        b.act(2, Action::Call).unwrap();
        let before: u64 = [100u64, 300, 1000, 50].iter().sum();
        for scores in [[1, 2, 3, 4], [4, 3, 2, 1], [2, 2, 2, 2], [9, 1, 9, 1]] {
            let out = b.payouts(&scores);
            let stacks: u64 = b.players.iter().map(|p| p.stack).sum();
            assert_eq!(out.iter().sum::<u64>() + stacks, before, "{scores:?}");
        }
    }
}
