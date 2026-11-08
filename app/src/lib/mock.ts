// Dev-only fake chain for working on the UI before (or without) a deployed
// contract: open any page with ?mock=deal|flop|river|result. Never bundled
// into production builds (guarded by import.meta.env.DEV in near.ts).

import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { CONTRACT } from "./config";
import { createIdentity, loadIdentity, playerId, xpubOf } from "./identity";
import { board as boardOf, deckSeed, hex, hole, saltCommitment, shuffle, unhex } from "./poker";
import type { Hand, HandRecord, Table } from "./types";

const enc = new TextEncoder();
const vrfSk = new Uint8Array(32).fill(4);
const salt = new Uint8Array(32).fill(7);

function vrfFor(table: number, no: string) {
  const alpha = `vrf:1182:${CONTRACT}:facedown-${table}-${no}`;
  const sig = ed25519.sign(enc.encode(alpha), vrfSk);
  return { output: hex(sha256(sig)), signature: hex(sig), alpha };
}

function seal(cards: number[], xpubHex: string, table: number, no: string, position: number) {
  const eph = crypto.getRandomValues(new Uint8Array(32));
  const epk = x25519.getPublicKey(eph);
  const xpub = unhex(xpubHex);
  const shared = x25519.getSharedSecret(eph, xpub);
  const key = sha256(new Uint8Array([...enc.encode("facedown/hole/v1"), ...shared, ...epk, ...xpub]));
  const aad = enc.encode(`facedown/${CONTRACT}/${table}/${no}/${position}`);
  return { epk: hex(epk), ct: hex(chacha20poly1305(key, new Uint8Array(12), aad).encrypt(new Uint8Array(cards))) };
}

export function mockView(method: string, args: Record<string, unknown>): unknown {
  const mode = new URLSearchParams(location.search).get("mock") ?? "flop";
  const id = loadIdentity() ?? createIdentity();
  const me = id ? playerId(id) : "me".padEnd(64, "0");
  const no = "41";
  const vrf = vrfFor(0, no);
  const deck = shuffle(deckSeed(unhex(vrf.output), salt));
  const names = ["Ansh", "Rook", "Mira", "Vega", "Pip"];
  const ids = [me, "bot:rook", "b".repeat(64), "bot:vega", "bot:pip"];
  const bots = [null, "rock", null, "shark", "fish"] as const;
  const stacks = [9_420, 10_000, 4_150, 7_880, 10_000];
  const seats = names.map((name, i) => ({ player: ids[i], name, stack: stacks[i], bot: bots[i], leaving: false, timeouts: 0, sitting_out: false }));
  const street = mode === "river" ? "river" : mode === "deal" ? "preflop" : "flop";
  const shownBoard = boardOf(deck, 5).slice(0, street === "river" ? 5 : street === "flop" ? 3 : 0);
  const bets = mode === "deal" ? [0, 0, 0, 25, 50] : street === "flop" ? [0, 0, 400, 400, 0] : [0, 0, 0, 0, 0];
  const hand: Hand = {
    no,
    ids,
    vrf: mode === "deal" ? null : vrf,
    salt_commit: mode === "deal" ? null : hex(saltCommitment(salt)),
    holes:
      mode === "deal"
        ? []
        : [0, 2].map((p) => ({ position: p, seat: p, ...seal(hole(deck, p), p === 0 && id ? xpubOf(id) : hex(x25519.getPublicKey(new Uint8Array(32).fill(9))), 0, no, p) })),
    board: shownBoard,
    log: [
      { position: 3, street: "preflop", action: { kind: "raise", to: 150 }, bet: "150", timed_out: false },
      { position: 4, street: "preflop", action: { kind: "fold" }, bet: "0", timed_out: false },
      { position: 0, street: "preflop", action: { kind: "call" }, bet: "150", timed_out: false },
      { position: 1, street: "preflop", action: { kind: "fold" }, bet: "0", timed_out: true },
      { position: 2, street: "preflop", action: { kind: "call" }, bet: "150", timed_out: false },
      ...(street !== "preflop"
        ? [
            { position: 2, street: "flop" as const, action: { kind: "raise" as const, to: 400 }, bet: "400", timed_out: false },
            { position: 3, street: "flop" as const, action: { kind: "call" as const }, bet: "400", timed_out: false },
          ]
        : []),
    ],
    pending:
      mode === "deal"
        ? { task: { kind: "deal" }, sent_ms: String(Date.now() - 2000), since_ms: String(Date.now() - 2000), attempts: 0 }
        : mode === "river"
          ? { task: { kind: "bot", position: 3 }, sent_ms: String(Date.now() - 1000), since_ms: String(Date.now() - 1000), attempts: 0 }
          : null,
    deadline_ms: String(Date.now() + 19_000),
    started_ms: String(Date.now() - 40_000),
    betting: {
      players: seats.map((s, i) => ({
        seat: i,
        stack: s.stack - bets[i],
        bet: bets[i],
        total: (i === 1 || i === 4 ? (i === 4 ? 25 : 50) : 150) + bets[i],
        folded: mode !== "deal" && (i === 1 || i === 4),
        all_in: false,
        acted: true,
        can_raise: true,
      })),
      button: 2,
      small_blind: 25,
      big_blind: 50,
      street,
      to_act: mode === "deal" ? null : mode === "river" ? 3 : 0,
      current_bet: street === "flop" ? 400 : 0,
      min_raise: 50,
    },
  };
  const table: Table = {
    id: 0,
    name: "The Back Room",
    small_blind: "25",
    big_blind: "50",
    max_seats: 6,
    seats: [...seats, null],
    button: 2,
    hands_dealt: no,
    hand: mode === "result" ? null : hand,
    created_by: null,
    last_hand: "40",
  };
  const record = (n: string): HandRecord => {
    const v = vrfFor(0, n);
    const d = shuffle(deckSeed(unhex(v.output), salt));
    return {
      table: 0,
      no: n,
      outcome: { kind: "showdown" },
      hands: names.map((name, p) => ({
        position: p,
        seat: p,
        player: ids[p],
        name,
        cards: hole(d, p),
        folded: p === 1 || p === 4,
        score: 0,
        category: p === 0 ? "Two pair" : p === 2 ? "Pair" : p === 3 ? "Straight" : "",
        won: p === 3 ? "2475" : "0",
        put_in: p === 1 ? "50" : p === 4 ? "25" : "800",
      })),
      board: boardOf(d, 5),
      pot: "2475",
      vrf: v,
      salt: hex(salt),
      salt_commit: hex(saltCommitment(salt)),
      log: hand.log,
      button_seat: 2,
      ended_ms: String(Date.now() - 1500),
    };
  };
  switch (method) {
    case "list_tables":
      return [
        { id: 0, name: "The Back Room", small_blind: "25", big_blind: "50", max_seats: 6, players: 2, bots: 3, hand_running: true, hands_dealt: "41" },
        { id: 1, name: "Heads-up with Vega", small_blind: "10", big_blind: "20", max_seats: 2, players: 0, bots: 1, hand_running: false, hands_dealt: "12" },
        { id: 2, name: "Low stakes, loose bots", small_blind: "5", big_blind: "10", max_seats: 4, players: 1, bots: 2, hand_running: true, hands_dealt: "88" },
      ];
    case "get_table":
      return mode === "result" ? { ...table, last_hand: "41" } : table;
    case "options":
      return mode === "flop" ? [0, { to_call: 400, can_check: false, can_raise: true, min_raise_to: 750, max_raise_to: 9420 }] : null;
    case "get_player":
      return args.id === me && id ? { name: "Ansh", xpub: xpubOf(id), chips: 12_300, nonce: 7, last_claim_ms: Date.now() - 5 * 3600_000, hands_played: 41, hands_won: 12, net: 2_310, joined_ms: 0 } : null;
    case "get_hand":
      return record(String(args.hand));
    case "recent_hands":
      return (mode === "result" ? ["41", "40", "39", "38"] : ["40", "39", "38"]).map(record);
    case "dealer_config":
      return { outlayer: "outlayer.testnet", project_id: "facedown.testnet/dealer", secrets_owner: "facedown.testnet", secrets_profile: "default", vrf_pubkey: hex(ed25519.getPublicKey(vrfSk)) };
    case "stats":
      return { tables: 3, hands_played: "141" };
  }
  throw new Error(`mock: ${method}`);
}
