//! Cards are bytes `0..52`: `rank = card % 13` (0 = deuce … 12 = ace) and
//! `suit = card / 13` (0 clubs, 1 diamonds, 2 hearts, 3 spades).

use alloc::string::String;

pub type Card = u8;

pub const DECK_SIZE: usize = 52;
const RANKS: &[u8; 13] = b"23456789TJQKA";
const SUITS: &[u8; 4] = b"cdhs";

pub fn rank(card: Card) -> u8 {
    card % 13
}

pub fn suit(card: Card) -> u8 {
    card / 13
}

/// "As", "Td", "2c".
pub fn to_string(card: Card) -> String {
    let mut s = String::with_capacity(2);
    s.push(RANKS[rank(card) as usize] as char);
    s.push(SUITS[suit(card) as usize] as char);
    s
}

pub fn parse(text: &str) -> Option<Card> {
    let bytes = text.as_bytes();
    if bytes.len() != 2 {
        return None;
    }
    let r = RANKS.iter().position(|&c| c == bytes[0].to_ascii_uppercase())?;
    let s = SUITS.iter().position(|&c| c == bytes[1].to_ascii_lowercase())?;
    Some((s * 13 + r) as Card)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_every_card() {
        for card in 0..DECK_SIZE as Card {
            assert_eq!(parse(&to_string(card)), Some(card));
        }
        assert_eq!(to_string(parse("As").unwrap()), "As");
        assert_eq!(rank(parse("2c").unwrap()), 0);
        assert_eq!(suit(parse("Ks").unwrap()), 3);
        assert_eq!(parse("1x"), None);
    }
}
