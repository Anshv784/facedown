//! Facedown: no-limit Hold'em where nobody can see or rig the cards.
//!
//! - **Players are keys, not accounts.** A browser makes an ed25519 key and
//!   signs every command; anyone (in practice our relayer) submits it with
//!   [`Facedown::relay`] and pays the gas. The relayer can delay a move but
//!   can't forge one.
//! - **The dealer is an OutLayer TDX enclave** (project `dealer_project`). It
//!   shuffles with OutLayer's verifiable random output plus a secret salt,
//!   commits to the salt, encrypts each player's hole cards to that player's
//!   x25519 key, and reveals board cards street by street.
//! - **The contract audits every hand.** It checks the VRF proof at the deal,
//!   and when the hand ends it checks the revealed salt against the
//!   commitment, rebuilds the whole deck and confirms every board card. Only
//!   then does it score the hands and pay. If anything fails, the hand is
//!   voided and every chip goes back.
//!
//! Chips are free play chips with no value.

mod dealer;
mod hands;
mod players;
pub mod types;
mod views;

#[cfg(test)]
mod tests;

use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub use types::*;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Players,
    Names,
    Tables,
    History,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Facedown {
    pub(crate) owner: AccountId,
    pub(crate) dealer: DealerConfig,
    pub(crate) players: LookupMap<String, PlayerRecord>,
    pub(crate) names: LookupMap<String, String>,
    pub(crate) tables: Vector<Table>,
    /// Finished hands, keyed `"{table}:{hand}"`.
    pub(crate) history: LookupMap<String, HandRecord>,
    pub(crate) hands_played: u64,
}

#[near]
impl Facedown {
    #[init]
    pub fn new(owner: AccountId, dealer: DealerConfig) -> Self {
        dealer.validate();
        Self {
            owner,
            dealer,
            players: LookupMap::new(StorageKey::Players),
            names: LookupMap::new(StorageKey::Names),
            tables: Vector::new(StorageKey::Tables),
            history: LookupMap::new(StorageKey::History),
            hands_played: 0,
        }
    }

    /// Points at a new dealer project or VRF key (owner only).
    pub fn set_dealer(&mut self, dealer: DealerConfig) {
        self.assert_owner();
        dealer.validate();
        self.dealer = dealer;
    }

    /// Opens a table with house bots already seated (owner only). Players can
    /// open their own tables through `relay`.
    pub fn create_house_table(
        &mut self,
        name: String,
        small_blind: u64,
        max_seats: u8,
        bots: Vec<BotStyle>,
    ) -> u32 {
        self.assert_owner();
        self.open_table(name, small_blind, max_seats, &bots, None)
    }
}

impl Facedown {
    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }
}
