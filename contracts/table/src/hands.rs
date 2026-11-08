//! The life of a hand: start, act, time out, settle or void.

use facedown_core::eval::Category;
use facedown_core::game::{Action, Betting, Progress};
use near_sdk::json_types::U64;
use near_sdk::{env, near, require, Promise};

use crate::*;

fn now() -> u64 {
    env::block_timestamp_ms()
}

#[near]
impl Facedown {
    /// Moves a table along: starts the next hand, sends a waiting dealer job,
    /// or plays the timeout for a player who ran out of time. Anyone may call
    /// it; the app's relayer calls it whenever a table is waiting.
    pub fn advance(&mut self, table: u32) -> Option<Promise> {
        let t = self
            .tables
            .get(table)
            .unwrap_or_else(|| env::panic_str("no such table"));
        let Some(hand) = &t.hand else {
            return self.try_start(table);
        };
        if let Some(p) = &hand.pending {
            if p.sent_ms.0 > 0 && now() > p.since_ms.0 + DEALER_ABANDON_MS {
                self.void_hand(table, "the dealer did not answer in time".into());
                return None;
            }
            return self.kick(table);
        }
        if now() >= hand.deadline_ms.0 {
            if let Some(position) = hand.betting.to_act {
                let action = hand.betting.timeout_action(position);
                self.apply(table, position, action, true);
                return self.kick(table);
            }
        }
        None
    }
}

impl Facedown {
    pub(crate) fn open_table(
        &mut self,
        name: String,
        small_blind: u64,
        max_seats: u8,
        bots: &[BotStyle],
        creator: Option<String>,
    ) -> u32 {
        require!((1..=1000).contains(&small_blind), "small blind 1 to 1000");
        require!((2..=6).contains(&max_seats), "2 to 6 seats");
        require!(
            bots.len() < max_seats as usize,
            "leave at least one seat for a player"
        );
        let name = name.trim().to_string();
        require!(
            (2..=32).contains(&name.chars().count()),
            "table name 2-32 characters"
        );
        let big_blind = small_blind * 2;
        let mut seats: Vec<Option<Seat>> = (0..max_seats).map(|_| None).collect();
        for (i, style) in bots.iter().enumerate() {
            // Spread bots around the table.
            let at = (i * max_seats as usize / bots.len().max(1) + 1) % max_seats as usize;
            let at = (0..max_seats as usize)
                .map(|k| (at + k) % max_seats as usize)
                .find(|&k| seats[k].is_none())
                .unwrap();
            seats[at] = Some(bot_seat(*style, big_blind));
        }
        let id = self.tables.len();
        self.tables.push(Table {
            id,
            name,
            small_blind: U64(small_blind),
            big_blind: U64(big_blind),
            max_seats,
            seats,
            button: 0,
            hands_dealt: U64(0),
            hand: None,
            created_by: creator,
            last_hand: None,
        });
        id
    }

    /// Starts a hand if none is running and two or more seats can play.
    pub(crate) fn try_start(&mut self, table_id: u32) -> Option<Promise> {
        let t = self.table_mut(table_id);
        if t.hand.is_some() {
            return None;
        }
        let n = t.seats.len();
        let ready = |s: &Option<Seat>| {
            s.as_ref()
                .is_some_and(|s| s.stack > 0 && !s.sitting_out && !s.leaving)
        };
        let order: Vec<usize> = (0..n).filter(|&i| ready(&t.seats[i])).collect();
        if order.len() < 2
            || order
                .iter()
                .all(|&i| t.seats[i].as_ref().unwrap().bot.is_some())
        {
            return None;
        }
        // Move the button to the next seat that is dealt in.
        let start = if t.hands_dealt.0 == 0 {
            n - 1
        } else {
            t.button as usize
        };
        let button_seat = (1..=n)
            .map(|k| (start + k) % n)
            .find(|i| order.contains(i))
            .unwrap();
        t.button = button_seat as u8;
        let button = order.iter().position(|&i| i == button_seat).unwrap();
        let stacks: Vec<(u8, u64)> = order
            .iter()
            .map(|&i| (i as u8, t.seats[i].as_ref().unwrap().stack))
            .collect();
        let ids = order
            .iter()
            .map(|&i| t.seats[i].as_ref().unwrap().player.clone())
            .collect();
        let betting = Betting::new(&stacks, button, t.small_blind.0, t.big_blind.0);
        let no = t.hands_dealt.0 + 1;
        t.hands_dealt = U64(no);
        t.hand = Some(Hand {
            no: U64(no),
            betting,
            ids,
            vrf: None,
            salt_commit: None,
            holes: vec![],
            board: vec![],
            log: vec![],
            pending: Some(Pending {
                task: DealerTask::Deal,
                sent_ms: U64(0),
                since_ms: U64(now()),
                attempts: 0,
            }),
            deadline_ms: U64(u64::MAX),
            started_ms: U64(now()),
        });
        self.kick(table_id)
    }

    pub(crate) fn player_act(
        &mut self,
        player: &str,
        table_id: u32,
        hand_no: u64,
        action: Action,
    ) -> Option<Promise> {
        let t = self.table_mut(table_id);
        let hand = t
            .hand
            .as_ref()
            .unwrap_or_else(|| env::panic_str("no hand is running"));
        require!(hand.no.0 == hand_no, "that hand is over");
        require!(hand.pending.is_none(), "wait for the dealer");
        let position = hand
            .ids
            .iter()
            .position(|id| id == player)
            .unwrap_or_else(|| env::panic_str("you are not in this hand"));
        self.apply(table_id, position, action, false);
        if let Some(seat) = self.seat_of(table_id, position) {
            seat.timeouts = 0;
        }
        self.kick(table_id)
    }

    fn seat_of(&mut self, table_id: u32, position: usize) -> Option<&mut Seat> {
        let t = self.table_mut(table_id);
        let seat = t.hand.as_ref()?.betting.players.get(position)?.seat as usize;
        t.seats[seat].as_mut()
    }

    /// Applies one betting action and works out what the table waits for next.
    pub(crate) fn apply(
        &mut self,
        table_id: u32,
        position: usize,
        action: Action,
        timed_out: bool,
    ) {
        let t = self.table_mut(table_id);
        let hand = t.hand.as_mut().unwrap();
        let street = hand.betting.street;
        let progress = hand
            .betting
            .act(position, action)
            .unwrap_or_else(|e| env::panic_str(e.as_str()));
        let bet = hand.betting.players[position].bet;
        hand.log.push(LogEntry {
            position: position as u8,
            street,
            action,
            bet: U64(bet),
            timed_out,
        });
        if hand.log.len() > MAX_LOG {
            hand.log.remove(0);
        }
        self.after(table_id, progress);
        if timed_out {
            if let Some(seat) = self.seat_of(table_id, position) {
                seat.timeouts += 1;
                if seat.timeouts >= 2 {
                    seat.sitting_out = true;
                }
            }
        }
    }

    /// Records what the table needs after betting moved.
    pub(crate) fn after(&mut self, table_id: u32, progress: Progress) {
        let t = self.table_mut(table_id);
        let hand = t.hand.as_mut().unwrap();
        let task = match progress {
            Progress::ToAct { player } => {
                hand.deadline_ms = U64(now() + ACTION_TIMEOUT_MS);
                let seat = hand.betting.players[player].seat as usize;
                if t.seats[seat].as_ref().is_some_and(|s| s.bot.is_some()) {
                    Some(DealerTask::Bot {
                        position: player as u8,
                    })
                } else {
                    None
                }
            }
            Progress::Deal { street } => Some(DealerTask::Board { street }),
            Progress::RunOut | Progress::Showdown | Progress::Uncontested { .. } => {
                Some(DealerTask::Finish)
            }
        };
        hand.pending = task.map(|task| Pending {
            task,
            sent_ms: U64(0),
            since_ms: U64(now()),
            attempts: 0,
        });
    }

    /// Settles a finished hand once the dealer has revealed the salt.
    pub(crate) fn settle(&mut self, table_id: u32, salt_hex: &str) {
        let t = self.tables.get(table_id).unwrap().clone();
        let hand = t.hand.clone().unwrap();
        let (Some(vrf), Some(commit)) = (&hand.vrf, &hand.salt_commit) else {
            return self.void_hand(table_id, "the hand was never dealt".into());
        };
        let salt: Option<[u8; 32]> = hex::decode(salt_hex).ok().and_then(|s| s.try_into().ok());
        let output: [u8; 32] = hex::decode(&vrf.output).unwrap().try_into().unwrap();
        let commit: [u8; 32] = hex::decode(commit).unwrap().try_into().unwrap();
        let n = hand.ids.len();
        let layout = match salt.map(|s| facedown_core::audit(&output, &s, &commit, n, &hand.board))
        {
            Some(Ok(layout)) => layout,
            Some(Err(e)) => {
                return self.void_hand(
                    table_id,
                    format!("the dealer's cards failed the audit: {e:?}"),
                )
            }
            None => return self.void_hand(table_id, "the dealer revealed a malformed salt".into()),
        };
        let b = &hand.betting;
        let uncontested = b.players.iter().filter(|p| !p.folded).count() == 1;
        let scores: Vec<u32> = (0..n)
            .map(|p| {
                if b.players[p].folded {
                    0
                } else {
                    facedown_core::score(&layout, p)
                }
            })
            .collect();
        let payouts = b.payouts(&scores);
        let board = layout.board().to_vec();

        let mut shown = Vec::with_capacity(n);
        for p in 0..n {
            let seat = b.players[p].seat;
            let s = t.seats[seat as usize].as_ref().unwrap();
            shown.push(ShownHand {
                position: p as u8,
                seat,
                player: hand.ids[p].clone(),
                name: s.name.clone(),
                cards: layout.hole(p),
                folded: b.players[p].folded,
                score: scores[p],
                category: if b.players[p].folded {
                    String::new()
                } else {
                    Category::from_score(scores[p]).name().into()
                },
                won: U64(payouts[p]),
                put_in: U64(b.players[p].total),
            });
        }

        // Pay out and update records.
        for (p, &paid) in payouts.iter().enumerate() {
            let seat = b.players[p].seat as usize;
            let final_stack = b.players[p].stack + paid;
            let net = paid as i64 - b.players[p].total as i64;
            let id = hand.ids[p].clone();
            let table = self.table_mut(table_id);
            if let Some(s) = table.seats[seat].as_mut() {
                s.stack = final_stack;
            }
            if let Some(r) = self.players.get_mut(&id) {
                r.hands_played += 1;
                r.net += net;
                if paid > b.players[p].total {
                    r.hands_won += 1;
                }
            }
        }
        let record = HandRecord {
            table: table_id,
            no: hand.no,
            outcome: if uncontested {
                Outcome::Uncontested
            } else {
                Outcome::Showdown
            },
            hands: shown,
            board: if uncontested {
                hand.board.clone()
            } else {
                board
            },
            pot: U64(b.pot()),
            vrf: hand.vrf.clone(),
            salt: Some(salt_hex.to_string()),
            salt_commit: hand.salt_commit.clone(),
            log: hand.log.clone(),
            button_seat: t.button,
            ended_ms: U64(now()),
        };
        self.finish_hand(table_id, record);
    }

    /// Ends a hand without a result: every chip each player put in goes back.
    pub(crate) fn void_hand(&mut self, table_id: u32, reason: String) {
        let t = self.table_mut(table_id);
        let Some(hand) = t.hand.clone() else { return };
        for p in &hand.betting.players {
            if let Some(s) = t.seats[p.seat as usize].as_mut() {
                s.stack = p.stack + p.total;
            }
        }
        let record = HandRecord {
            table: table_id,
            no: hand.no,
            outcome: Outcome::Voided { reason },
            hands: vec![],
            board: hand.board.clone(),
            pot: U64(hand.betting.pot()),
            vrf: hand.vrf.clone(),
            salt: None,
            salt_commit: hand.salt_commit.clone(),
            log: hand.log.clone(),
            button_seat: t.button,
            ended_ms: U64(now()),
        };
        self.finish_hand(table_id, record);
    }

    fn finish_hand(&mut self, table_id: u32, record: HandRecord) {
        let key = format!("{table_id}:{}", record.no.0);
        let no = record.no;
        self.history.insert(key, record);
        self.hands_played += 1;
        let t = self.table_mut(table_id);
        t.hand = None;
        t.last_hand = Some(no);
        let big_blind = t.big_blind.0;
        // Stand up leavers and busted players; bots rebuy.
        let mut returns: Vec<(String, u64)> = vec![];
        for slot in t.seats.iter_mut() {
            let Some(s) = slot else { continue };
            if s.bot.is_some() {
                if s.stack < big_blind {
                    s.stack = 100 * big_blind;
                }
                continue;
            }
            if s.leaving || s.stack == 0 {
                returns.push((s.player.clone(), s.stack));
                *slot = None;
            }
        }
        for (player, chips) in returns {
            if let Some(r) = self.players.get_mut(&player) {
                r.chips += chips;
            }
        }
    }
}

pub(crate) fn bot_seat(style: BotStyle, big_blind: u64) -> Seat {
    Seat {
        player: format!("bot:{}", style.name().to_lowercase()),
        name: style.name().into(),
        stack: 100 * big_blind,
        bot: Some(style),
        leaving: false,
        timeouts: 0,
        sitting_out: false,
    }
}
