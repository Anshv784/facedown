// JSON shapes returned by the table contract's views.
import type { Card, Vrf } from "./poker";

export type Street = "preflop" | "flop" | "turn" | "river";
export type BotStyle = "rock" | "shark" | "fish";
export type Action =
  | { kind: "fold" }
  | { kind: "check" }
  | { kind: "call" }
  | { kind: "raise"; to: number }
  | { kind: "all_in" };

export type Seat = {
  player: string;
  name: string;
  stack: number;
  bot: BotStyle | null;
  leaving: boolean;
  timeouts: number;
  sitting_out: boolean;
};

export type BetPlayer = {
  seat: number;
  stack: number;
  bet: number;
  total: number;
  folded: boolean;
  all_in: boolean;
  acted: boolean;
  can_raise: boolean;
};

export type Betting = {
  players: BetPlayer[];
  button: number;
  small_blind: number;
  big_blind: number;
  street: Street;
  to_act: number | null;
  current_bet: number;
  min_raise: number;
};

export type DealerTask =
  | { kind: "deal" }
  | { kind: "board"; street: Street }
  | { kind: "finish" }
  | { kind: "bot"; position: number };

export type Pending = { task: DealerTask; sent_ms: string; since_ms: string; attempts: number };
export type SealedHole = { position: number; seat: number; epk: string; ct: string };
export type LogEntry = { position: number; street: Street; action: Action; bet: string; timed_out: boolean };

export type Hand = {
  no: string;
  betting: Betting;
  ids: string[];
  vrf: Vrf | null;
  salt_commit: string | null;
  holes: SealedHole[];
  board: Card[];
  log: LogEntry[];
  pending: Pending | null;
  deadline_ms: string;
  started_ms: string;
};

export type Table = {
  id: number;
  name: string;
  small_blind: string;
  big_blind: string;
  max_seats: number;
  seats: (Seat | null)[];
  button: number;
  hands_dealt: string;
  hand: Hand | null;
  created_by: string | null;
  last_hand: string | null;
};

export type TableSummary = {
  id: number;
  name: string;
  small_blind: string;
  big_blind: string;
  max_seats: number;
  players: number;
  bots: number;
  hand_running: boolean;
  hands_dealt: string;
};

export type Options = {
  to_call: number;
  can_check: boolean;
  can_raise: boolean;
  min_raise_to: number;
  max_raise_to: number;
};

export type PlayerRecord = {
  name: string;
  xpub: string;
  chips: number;
  nonce: number;
  last_claim_ms: number;
  hands_played: number;
  hands_won: number;
  net: number;
  joined_ms: number;
};

export type ShownHand = {
  position: number;
  seat: number;
  player: string;
  name: string;
  cards: [Card, Card];
  folded: boolean;
  score: number;
  category: string;
  won: string;
  put_in: string;
};

export type Outcome = { kind: "showdown" } | { kind: "uncontested" } | { kind: "voided"; reason: string };

export type HandRecord = {
  table: number;
  no: string;
  outcome: Outcome;
  hands: ShownHand[];
  board: Card[];
  pot: string;
  vrf: Vrf | null;
  salt: string | null;
  salt_commit: string | null;
  log: LogEntry[];
  button_seat: number;
  ended_ms: string;
};

export type DealerConfig = {
  outlayer: string;
  project_id: string;
  secrets_owner: string;
  secrets_profile: string;
  vrf_pubkey: string;
};

export type Command =
  | { do: "register"; name: string; xpub: string }
  | { do: "claim" }
  | { do: "sit"; table: number; seat: number; buy_in: string }
  | { do: "leave"; table: number }
  | { do: "sit_in"; table: number }
  | { do: "act"; table: number; hand: string; action: Action }
  | { do: "open_table"; name: string; small_blind: string; max_seats: number; bots: BotStyle[] }
  | { do: "set_xpub"; xpub: string };
