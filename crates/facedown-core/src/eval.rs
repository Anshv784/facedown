//! Best five-card hand out of seven, as one comparable number.
//!
//! `score = category << 20 | r1 << 16 | r2 << 12 | r3 << 8 | r4 << 4 | r5`,
//! where ranks are 0 (deuce) … 12 (ace) and listed most significant first.
//! A higher score always wins; equal scores split.

use crate::cards::{rank, suit, Card};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Category {
    HighCard = 0,
    Pair = 1,
    TwoPair = 2,
    Trips = 3,
    Straight = 4,
    Flush = 5,
    FullHouse = 6,
    Quads = 7,
    StraightFlush = 8,
}

impl Category {
    pub fn from_score(score: u32) -> Self {
        match score >> 20 {
            0 => Self::HighCard,
            1 => Self::Pair,
            2 => Self::TwoPair,
            3 => Self::Trips,
            4 => Self::Straight,
            5 => Self::Flush,
            6 => Self::FullHouse,
            7 => Self::Quads,
            _ => Self::StraightFlush,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::HighCard => "High card",
            Self::Pair => "Pair",
            Self::TwoPair => "Two pair",
            Self::Trips => "Three of a kind",
            Self::Straight => "Straight",
            Self::Flush => "Flush",
            Self::FullHouse => "Full house",
            Self::Quads => "Four of a kind",
            Self::StraightFlush => "Straight flush",
        }
    }
}

fn pack(category: Category, ranks: &[u8]) -> u32 {
    let mut score = (category as u32) << 20;
    for (i, &r) in ranks.iter().take(5).enumerate() {
        score |= (r as u32) << (16 - 4 * i);
    }
    score
}

/// Highest card of a straight in a 13-bit rank mask, ace-low wheel included.
fn straight_high(mask: u16) -> Option<u8> {
    for high in (4..13u8).rev() {
        let need = 0b1_1111u16 << (high - 4);
        if mask & need == need {
            return Some(high);
        }
    }
    // A-2-3-4-5: ace (bit 12) plus 2..5 (bits 0..3); the five is high.
    let wheel = (1u16 << 12) | 0b1111;
    (mask & wheel == wheel).then_some(3)
}

/// Ranks present in `mask`, highest first.
fn ranks_desc(mask: u16) -> impl Iterator<Item = u8> {
    (0..13u8).rev().filter(move |r| mask & (1 << r) != 0)
}

/// Scores 5 to 7 cards (the best five are used).
pub fn evaluate(cards: &[Card]) -> u32 {
    assert!((5..=7).contains(&cards.len()), "5 to 7 cards");
    let mut counts = [0u8; 13];
    let mut suit_masks = [0u16; 4];
    let mut all = 0u16;
    for &c in cards {
        counts[rank(c) as usize] += 1;
        suit_masks[suit(c) as usize] |= 1 << rank(c);
        all |= 1 << rank(c);
    }

    // Flushes and straight flushes.
    if let Some(&fmask) = suit_masks.iter().find(|m| m.count_ones() >= 5) {
        if let Some(high) = straight_high(fmask) {
            return pack(Category::StraightFlush, &[high]);
        }
        let top: alloc::vec::Vec<u8> = ranks_desc(fmask).take(5).collect();
        return pack(Category::Flush, &top);
    }

    let by = |n: u8| (0..13u8).rev().filter(move |&r| counts[r as usize] == n);
    let quads: alloc::vec::Vec<u8> = by(4).collect();
    let trips: alloc::vec::Vec<u8> = by(3).collect();
    let pairs: alloc::vec::Vec<u8> = by(2).collect();
    let kicker = |exclude: &[u8], n: usize| -> alloc::vec::Vec<u8> {
        ranks_desc(all)
            .filter(|r| !exclude.contains(r))
            .take(n)
            .collect()
    };

    if let Some(&q) = quads.first() {
        let k = kicker(&[q], 1);
        return pack(Category::Quads, &[q, k[0]]);
    }
    if let Some(&t) = trips.first() {
        // A second set of trips also fills the house.
        let pair = trips
            .get(1)
            .copied()
            .into_iter()
            .chain(pairs.iter().copied())
            .max();
        if let Some(p) = pair {
            return pack(Category::FullHouse, &[t, p]);
        }
    }
    if let Some(high) = straight_high(all) {
        return pack(Category::Straight, &[high]);
    }
    if let Some(&t) = trips.first() {
        let k = kicker(&[t], 2);
        return pack(Category::Trips, &[t, k[0], k[1]]);
    }
    if pairs.len() >= 2 {
        let (a, b) = (pairs[0], pairs[1]);
        let k = kicker(&[a, b], 1);
        return pack(Category::TwoPair, &[a, b, k[0]]);
    }
    if let Some(&p) = pairs.first() {
        let k = kicker(&[p], 3);
        return pack(Category::Pair, &[p, k[0], k[1], k[2]]);
    }
    let k = kicker(&[], 5);
    pack(Category::HighCard, &k)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::parse;
    use alloc::vec::Vec;

    fn hand(s: &str) -> Vec<Card> {
        s.split_whitespace().map(|c| parse(c).unwrap()).collect()
    }
    fn score(s: &str) -> u32 {
        evaluate(&hand(s))
    }
    fn cat(s: &str) -> Category {
        Category::from_score(score(s))
    }

    #[test]
    fn categories() {
        assert_eq!(cat("As Ks Qs Js Ts 2c 3d"), Category::StraightFlush);
        assert_eq!(cat("Ah Ad Ac As 2c 3d 7h"), Category::Quads);
        assert_eq!(cat("Ah Ad Ac Ks Kc 3d 7h"), Category::FullHouse);
        assert_eq!(cat("Ah 2h 7h 9h Jh Kd Kc"), Category::Flush);
        assert_eq!(cat("9c Td Jh Qs Kd 2c 2d"), Category::Straight);
        assert_eq!(cat("7c 7d 7h Qs 2d 4c 9d"), Category::Trips);
        assert_eq!(cat("7c 7d Qh Qs 2d 4c 9d"), Category::TwoPair);
        assert_eq!(cat("7c 7d Qh As 2d 4c 9d"), Category::Pair);
        assert_eq!(cat("7c 8d Qh As 2d 4c 9d"), Category::HighCard);
    }

    #[test]
    fn wheels_and_their_rank() {
        assert_eq!(cat("Ac 2d 3h 4s 5d Kc Kd"), Category::Straight);
        assert!(
            score("Ac 2d 3h 4s 5d Kc Qd") < score("2c 3d 4h 5s 6d Kc Qd"),
            "the wheel is the lowest straight"
        );
        assert_eq!(cat("Ah 2h 3h 4h 5h Kc Kd"), Category::StraightFlush);
        assert!(score("Ah 2h 3h 4h 5h 9c 9d") < score("2h 3h 4h 5h 6h 9c 9d"));
    }

    #[test]
    fn kickers_and_ties() {
        // Same pair, better kicker.
        assert!(score("Ah Ad Kc 7s 4d 3c 2h") > score("Ah Ad Qc 7s 4d 3c 2h"));
        // Board plays: identical scores split.
        assert_eq!(score("Ah Kh Qd Jc 9s 2c 3d"), score("Ah Kh Qd Jc 9s 2h 4d"));
        // Two pair compares top pair, then second, then kicker.
        assert!(score("Kh Kd 9c 9s Ad 3c 2h") > score("Kh Kd 8c 8s Ad 3c 2h"));
        // Two trips make a full house with the higher trips on top.
        assert_eq!(
            score("7c 7d 7h 9s 9d 9c 2h"),
            pack(Category::FullHouse, &[7, 5])
        );
        // Three pairs: the third pair can play as the kicker.
        assert_eq!(
            score("Kh Kd Qc Qs Jd Jc 2h"),
            pack(Category::TwoPair, &[11, 10, 9])
        );
        // Flush beats straight even when both are present.
        assert_eq!(cat("4h 5h 6h 7h 9h 8c 2d"), Category::Flush);
    }

    #[test]
    fn full_house_over_flush_is_not_confused() {
        assert_eq!(cat("Ah Ad Ac Kh Kd 2h 7h"), Category::FullHouse);
        assert_eq!(cat("Ah Kh 2h 7h 9h Kd Ks"), Category::Flush);
    }
}
