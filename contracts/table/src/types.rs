use facedown_core::cards::Card;
use facedown_core::game::{Action, Betting, Street};
use near_sdk::json_types::U64;
use near_sdk::{near, require};

/// Starting chips and the faucet.
pub const STARTING_CHIPS: u64 = 5_000;
pub const CLAIM_CHIPS: u64 = 2_000;
pub const CLAIM_EVERY_MS: u64 = 4 * 60 * 60 * 1000;
pub const ACTION_TIMEOUT_MS: u64 = 30_000;
/// After this long without a dealer answer, `advance` may retry the job.
pub const DEALER_RETRY_MS: u64 = 45_000;
/// After this long stuck on the dealer, anyone may void the hand.
pub const DEALER_ABANDON_MS: u64 = 5 * 60 * 1000;
pub const MAX_LOG: usize = 80;
pub const MAX_NAME: usize = 20;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct DealerConfig {
    /// The OutLayer contract, e.g. `outlayer.testnet`.
    pub outlayer: near_sdk::AccountId,
    /// OutLayer project id, e.g. `anshv784.testnet/facedown-dealer`.
    pub project_id: String,
    /// Owner of the dealer's secrets in OutLayer.
    pub secrets_owner: near_sdk::AccountId,
    pub secrets_profile: String,
    /// OutLayer's VRF public key (hex), from `/vrf/pubkey`.
    pub vrf_pubkey: String,
}

impl DealerConfig {
    pub fn validate(&self) {
        let key = hex::decode(&self.vrf_pubkey).unwrap_or_default();
        require!(key.len() == 32, "vrf_pubkey must be 32 bytes of hex");
        require!(self.project_id.contains('/'), "project_id is owner/name");
    }

    pub fn vrf_key(&self) -> [u8; 32] {
        hex::decode(&self.vrf_pubkey).unwrap().try_into().unwrap()
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PlayerRecord {
    pub name: String,
    /// X25519 public key (hex) the dealer encrypts hole cards to.
    pub xpub: String,
    /// Chips not at a table.
    pub chips: u64,
    /// Next expected command nonce.
    pub nonce: u64,
    pub last_claim_ms: u64,
    pub hands_played: u64,
    pub hands_won: u64,
    /// Net chips won or lost at tables.
    pub net: i64,
    pub joined_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BotStyle {
    /// Plays solid hands, rarely bluffs.
    Rock,
    /// Bets and raises a lot.
    Shark,
    /// Calls too much.
    Fish,
}

impl BotStyle {
    pub fn name(self) -> &'static str {
        match self {
            BotStyle::Rock => "Rook",
            BotStyle::Shark => "Vega",
            BotStyle::Fish => "Pip",
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Seat {
    /// Player id (ed25519 key hex), or `bot:<name>` for a house bot.
    pub player: String,
    pub name: String,
    pub stack: u64,
    pub bot: Option<BotStyle>,
    /// Stand up when the current hand ends.
    pub leaving: bool,
    /// Consecutive timeouts; two in a row sits the player out.
    pub timeouts: u8,
    pub sitting_out: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DealerTask {
    Deal,
    Board {
        street: Street,
    },
    /// Reveal the salt and settle (showdown, run-out or uncontested).
    Finish,
    Bot {
        position: u8,
    },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Pending {
    pub task: DealerTask,
    /// When the request was last sent (0 = not yet sent).
    pub sent_ms: U64,
    pub since_ms: U64,
    /// Failed attempts so far.
    pub attempts: u8,
}

/// One player's hole cards, encrypted to their x25519 key by the dealer.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct SealedHole {
    pub position: u8,
    pub seat: u8,
    /// Dealer's ephemeral x25519 public key (hex).
    pub epk: String,
    /// ChaCha20-Poly1305 ciphertext of the two cards (hex).
    pub ct: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct LogEntry {
    pub position: u8,
    pub street: Street,
    pub action: Action,
    /// Chips this street after the action.
    pub bet: U64,
    pub timed_out: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Vrf {
    pub output: String,
    pub signature: String,
    pub alpha: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Hand {
    pub no: U64,
    pub betting: Betting,
    /// Player ids by position.
    pub ids: Vec<String>,
    pub vrf: Option<Vrf>,
    pub salt_commit: Option<String>,
    pub holes: Vec<SealedHole>,
    pub board: Vec<Card>,
    pub log: Vec<LogEntry>,
    pub pending: Option<Pending>,
    /// When the player to act times out.
    pub deadline_ms: U64,
    pub started_ms: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Table {
    pub id: u32,
    pub name: String,
    pub small_blind: U64,
    pub big_blind: U64,
    pub max_seats: u8,
    pub seats: Vec<Option<Seat>>,
    /// Seat index of the button.
    pub button: u8,
    pub hands_dealt: U64,
    pub hand: Option<Hand>,
    pub created_by: Option<String>,
    pub last_hand: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct ShownHand {
    pub position: u8,
    pub seat: u8,
    pub player: String,
    pub name: String,
    pub cards: [Card; 2],
    pub folded: bool,
    /// 7-card score; 0 when folded.
    pub score: u32,
    pub category: String,
    pub won: U64,
    pub put_in: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Outcome {
    Showdown,
    Uncontested,
    /// The dealer failed or its cards didn't audit: every chip went back.
    Voided {
        reason: String,
    },
}

/// Everything needed to re-check a finished hand without trusting anyone.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct HandRecord {
    pub table: u32,
    pub no: U64,
    pub outcome: Outcome,
    pub hands: Vec<ShownHand>,
    pub board: Vec<Card>,
    pub pot: U64,
    pub vrf: Option<Vrf>,
    pub salt: Option<String>,
    pub salt_commit: Option<String>,
    pub log: Vec<LogEntry>,
    pub button_seat: u8,
    pub ended_ms: U64,
}

/// Commands players sign. `relay` checks the signature and the nonce.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
#[serde(tag = "do", rename_all = "snake_case")]
pub enum Command {
    Register {
        name: String,
        xpub: String,
    },
    Claim,
    Sit {
        table: u32,
        seat: u8,
        buy_in: U64,
    },
    Leave {
        table: u32,
    },
    /// Come back after being sat out for timing out.
    SitIn {
        table: u32,
    },
    Act {
        table: u32,
        hand: U64,
        action: Action,
    },
    OpenTable {
        name: String,
        small_blind: U64,
        max_seats: u8,
        bots: Vec<BotStyle>,
    },
    SetXpub {
        xpub: String,
    },
}
