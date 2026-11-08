//! Facedown's rules, shared by the table contract, the dealer enclave and
//! (mirrored in TypeScript) the browser verifier.

#![no_std]
extern crate alloc;

pub mod cards;
pub mod deck;
pub mod eval;
pub mod game;

use cards::Card;
use deck::{salt_commitment, Layout};

/// Why a finished hand fails its audit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuditError {
    /// The revealed salt is not the one committed at the deal.
    SaltMismatch,
    /// A board card shown during the hand differs from the deck.
    BoardMismatch,
}

/// Recomputes a finished hand from public data and checks it.
///
/// `board_shown` holds the board cards revealed while the hand was live (0, 3,
/// 4 or 5 of them). Returns the full layout, so callers can read every
/// player's hole cards and score the showdown.
pub fn audit(
    vrf_output: &[u8; 32],
    salt: &[u8; 32],
    salt_commit: &[u8; 32],
    players: usize,
    board_shown: &[Card],
) -> Result<Layout, AuditError> {
    if &salt_commitment(salt) != salt_commit {
        return Err(AuditError::SaltMismatch);
    }
    let layout = Layout::new(vrf_output, salt, players);
    if board_shown != &layout.board()[..board_shown.len()] {
        return Err(AuditError::BoardMismatch);
    }
    Ok(layout)
}

/// The 7-card score of player `position` on a full board.
pub fn score(layout: &Layout, position: usize) -> u32 {
    let h = layout.hole(position);
    let b = layout.board();
    eval::evaluate(&[h[0], h[1], b[0], b[1], b[2], b[3], b[4]])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_accepts_the_real_salt_and_board() {
        let (vrf, salt) = ([3u8; 32], [4u8; 32]);
        let commit = salt_commitment(&salt);
        let real = Layout::new(&vrf, &salt, 3);
        let layout = audit(&vrf, &salt, &commit, 3, &real.board()[..4]).unwrap();
        assert_eq!(layout, real);
    }

    #[test]
    fn audit_rejects_a_swapped_salt_or_board() {
        let (vrf, salt) = ([3u8; 32], [4u8; 32]);
        let commit = salt_commitment(&salt);
        assert_eq!(
            audit(&vrf, &[5; 32], &commit, 3, &[]),
            Err(AuditError::SaltMismatch)
        );
        let mut board = Layout::new(&vrf, &salt, 3).board();
        board[0] = (board[0] + 1) % 52;
        assert_eq!(
            audit(&vrf, &salt, &commit, 3, &board[..3]),
            Err(AuditError::BoardMismatch)
        );
    }
}
