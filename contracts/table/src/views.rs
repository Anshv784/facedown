use facedown_core::game::Options;
use near_sdk::json_types::U64;
use near_sdk::near;

use crate::*;

#[near(serializers = [json])]
pub struct TableSummary {
    pub id: u32,
    pub name: String,
    pub small_blind: U64,
    pub big_blind: U64,
    pub max_seats: u8,
    pub players: u8,
    pub bots: u8,
    pub hand_running: bool,
    pub hands_dealt: U64,
}

/// One row of the leaderboard (human players only; bots have no record).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct LeaderEntry {
    pub player: String,
    pub name: String,
    pub net: near_sdk::json_types::I64,
    pub hands: U64,
    pub won: U64,
}

/// The top players by net chips, kept under its own storage key so adding
/// it needed no change to the contract's state layout.
const LEADERBOARD_KEY: &[u8] = b"lb";
const LEADERBOARD_SIZE: usize = 20;

pub(crate) fn read_leaderboard() -> Vec<LeaderEntry> {
    near_sdk::env::storage_read(LEADERBOARD_KEY)
        .and_then(|b| near_sdk::borsh::from_slice(&b).ok())
        .unwrap_or_default()
}

pub(crate) fn update_leaderboard(entry: LeaderEntry) {
    let mut board = read_leaderboard();
    board.retain(|e| e.player != entry.player);
    board.push(entry);
    board.sort_by(|a, b| b.net.0.cmp(&a.net.0).then(b.hands.0.cmp(&a.hands.0)));
    board.truncate(LEADERBOARD_SIZE);
    near_sdk::env::storage_write(LEADERBOARD_KEY, &near_sdk::borsh::to_vec(&board).unwrap());
}

#[near(serializers = [json])]
pub struct Stats {
    pub tables: u32,
    pub hands_played: U64,
}

#[near]
impl Facedown {
    pub fn get_table(&self, id: u32) -> Option<Table> {
        self.tables.get(id).cloned()
    }

    pub fn list_tables(&self) -> Vec<TableSummary> {
        self.tables
            .iter()
            .map(|t| TableSummary {
                id: t.id,
                name: t.name.clone(),
                small_blind: t.small_blind,
                big_blind: t.big_blind,
                max_seats: t.max_seats,
                players: t.seats.iter().flatten().filter(|s| s.bot.is_none()).count() as u8,
                bots: t.seats.iter().flatten().filter(|s| s.bot.is_some()).count() as u8,
                hand_running: t.hand.is_some(),
                hands_dealt: t.hands_dealt,
            })
            .collect()
    }

    /// What the player to act may do right now.
    pub fn options(&self, table: u32) -> Option<(u8, Options)> {
        let hand = self.tables.get(table)?.hand.as_ref()?;
        if hand.pending.is_some() {
            return None;
        }
        let p = hand.betting.to_act?;
        Some((p as u8, hand.betting.options(p)))
    }

    pub fn get_player(&self, id: String) -> Option<PlayerRecord> {
        self.players.get(&id).cloned()
    }

    pub fn find_player(&self, name: String) -> Option<(String, PlayerRecord)> {
        let id = self.names.get(&name.trim().to_lowercase())?.clone();
        let record = self.players.get(&id)?.clone();
        Some((id, record))
    }

    pub fn get_hand(&self, table: u32, hand: U64) -> Option<HandRecord> {
        self.history.get(&format!("{table}:{}", hand.0)).cloned()
    }

    /// The most recent finished hands at a table, newest first.
    pub fn recent_hands(&self, table: u32, count: Option<u32>) -> Vec<HandRecord> {
        let Some(t) = self.tables.get(table) else {
            return vec![];
        };
        let Some(last) = t.last_hand else {
            return vec![];
        };
        let count = count.unwrap_or(10).min(30) as u64;
        (0..count)
            .filter_map(|k| last.0.checked_sub(k))
            .filter(|&n| n > 0)
            .filter_map(|n| self.history.get(&format!("{table}:{n}")).cloned())
            .collect()
    }

    /// Top 20 human players by net chips won at the tables.
    pub fn leaderboard(&self) -> Vec<LeaderEntry> {
        read_leaderboard()
    }

    pub fn dealer_config(&self) -> DealerConfig {
        self.dealer.clone()
    }

    pub fn stats(&self) -> Stats {
        Stats {
            tables: self.tables.len(),
            hands_played: U64(self.hands_played),
        }
    }
}
