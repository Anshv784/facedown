// A line-for-line port of crates/facedown-core, so the browser can rebuild
// and audit any finished hand without trusting the contract, the dealer or
// this website's server. Tests pin it to the same vectors as the Rust code.

import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";

export type Card = number;

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";

export const rank = (c: Card) => c % 13;
export const suit = (c: Card) => Math.floor(c / 13);
export const cardText = (c: Card) => RANKS[rank(c)] + SUITS[suit(c)];
export const parseCard = (s: string): Card => SUITS.indexOf(s[1]) * 13 + RANKS.indexOf(s[0].toUpperCase());

const enc = new TextEncoder();
export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function unhex(s: string): Uint8Array {
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error("not hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

export const deckSeed = (vrf: Uint8Array, salt: Uint8Array) => sha256(concat(enc.encode("facedown/deck/v1"), vrf, salt));
export const saltCommitment = (salt: Uint8Array) => sha256(concat(enc.encode("facedown/salt/v1"), salt));

/** Fisher-Yates over 0..52 driven by sha256(seed || counter_be32) blocks. */
export function shuffle(seed: Uint8Array): Card[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  let counter = 0;
  let block = new Uint8Array(0);
  let pos = 32;
  const nextU32 = () => {
    if (pos === 32) {
      const c = new Uint8Array(4);
      new DataView(c.buffer).setUint32(0, counter++, false);
      block = sha256(concat(seed, c));
      pos = 0;
    }
    const v = new DataView(block.buffer, block.byteOffset).getUint32(pos, false);
    pos += 4;
    return v;
  };
  const below = (n: number) => {
    const zone = Math.floor(0xffffffff / n) * n;
    for (;;) {
      const v = nextU32();
      if (v < zone) return v % n;
    }
  };
  for (let i = 51; i >= 1; i--) {
    const j = below(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export const hole = (deck: Card[], position: number): [Card, Card] => [deck[2 * position], deck[2 * position + 1]];
export const board = (deck: Card[], players: number) => deck.slice(2 * players, 2 * players + 5);

// ---- hand evaluation (same packing as eval.rs) ----

export const CATEGORIES = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
];

const pack = (cat: number, ranks: number[]) =>
  ranks.slice(0, 5).reduce((s, r, i) => s | (r << (16 - 4 * i)), cat << 20) >>> 0;

function straightHigh(mask: number): number | null {
  for (let high = 12; high >= 4; high--) {
    const need = 0b11111 << (high - 4);
    if ((mask & need) === need) return high;
  }
  const wheel = (1 << 12) | 0b1111;
  return (mask & wheel) === wheel ? 3 : null;
}
const ranksDesc = (mask: number) => [...Array(13).keys()].reverse().filter((r) => mask & (1 << r));

export function evaluate(cards: Card[]): number {
  const counts = new Array(13).fill(0);
  const suits = [0, 0, 0, 0];
  let all = 0;
  for (const c of cards) {
    counts[rank(c)]++;
    suits[suit(c)] |= 1 << rank(c);
    all |= 1 << rank(c);
  }
  const fmask = suits.find((m) => popcount(m) >= 5);
  if (fmask !== undefined) {
    const h = straightHigh(fmask);
    if (h !== null) return pack(8, [h]);
    return pack(5, ranksDesc(fmask).slice(0, 5));
  }
  const by = (n: number) => [...Array(13).keys()].reverse().filter((r) => counts[r] === n);
  const quads = by(4), trips = by(3), pairs = by(2);
  const kicker = (ex: number[], n: number) => ranksDesc(all).filter((r) => !ex.includes(r)).slice(0, n);
  if (quads.length) return pack(7, [quads[0], kicker([quads[0]], 1)[0]]);
  if (trips.length) {
    const p = [...trips.slice(1, 2), ...pairs];
    if (p.length) return pack(6, [trips[0], Math.max(...p)]);
  }
  const s = straightHigh(all);
  if (s !== null) return pack(4, [s]);
  if (trips.length) return pack(3, [trips[0], ...kicker([trips[0]], 2)]);
  if (pairs.length >= 2) return pack(2, [pairs[0], pairs[1], ...kicker([pairs[0], pairs[1]], 1)]);
  if (pairs.length) return pack(1, [pairs[0], ...kicker([pairs[0]], 3)]);
  return pack(0, kicker([], 5));
}
const popcount = (m: number) => m.toString(2).replace(/0/g, "").length;
export const categoryOf = (score: number) => CATEGORIES[Math.min(score >>> 20, 8)];

// ---- audit ----

export type Vrf = { output: string; signature: string; alpha: string };

export type Check = { label: string; detail: string; ok: boolean };

/**
 * Re-checks a finished hand from public data alone:
 * 1. OutLayer's VRF signature over the hand's seed is valid,
 * 2. the random output is sha256 of that signature (so it wasn't chosen),
 * 3. the revealed salt matches what was committed before any card was seen,
 * 4. the deck rebuilt from (VRF, salt) produced the board everyone saw,
 * 5. and every revealed hand.
 */
export function auditHand(args: {
  vrfPubkey: string;
  vrf: Vrf;
  expectedSeed: string;
  salt: string;
  saltCommit: string;
  players: number;
  board: Card[];
  shown: { position: number; cards: [Card, Card] }[];
}): { checks: Check[]; deck: Card[] | null } {
  const checks: Check[] = [];
  const { vrf } = args;
  const seedOk = vrf.alpha.startsWith("vrf:") && vrf.alpha.endsWith(`:${args.expectedSeed}`);
  checks.push({
    label: "Randomness was asked for this exact hand",
    detail: `alpha = ${vrf.alpha}`,
    ok: seedOk,
  });
  let sigOk = false;
  try {
    sigOk = ed25519.verify(unhex(vrf.signature), enc.encode(vrf.alpha), unhex(args.vrfPubkey));
  } catch {
    sigOk = false;
  }
  checks.push({
    label: "OutLayer's VRF key signed it",
    detail: `ed25519 signature checked against ${args.vrfPubkey.slice(0, 16)}…`,
    ok: sigOk,
  });
  const outOk = hex(sha256(unhex(vrf.signature))) === vrf.output;
  checks.push({
    label: "The random number is the signature's hash, so nobody picked it",
    detail: `sha256(signature) = ${vrf.output.slice(0, 24)}…`,
    ok: outOk,
  });
  const salt = unhex(args.salt);
  const commitOk = hex(saltCommitment(salt)) === args.saltCommit;
  checks.push({
    label: "The dealer's secret matches what it locked in before the deal",
    detail: `sha256("facedown/salt/v1" ‖ salt) = ${args.saltCommit.slice(0, 24)}…`,
    ok: commitOk,
  });
  const deck = shuffle(deckSeed(unhex(vrf.output), salt));
  const want = board(deck, args.players).slice(0, args.board.length);
  const boardOk = want.length === args.board.length && want.every((c, i) => c === args.board[i]);
  checks.push({
    label: "The rebuilt deck dealt exactly this board",
    detail: args.board.length ? args.board.map(cardText).join(" ") : "no board was dealt",
    ok: boardOk,
  });
  const handsOk = args.shown.every((s) => {
    const h = hole(deck, s.position);
    return h[0] === s.cards[0] && h[1] === s.cards[1];
  });
  checks.push({
    label: "…and exactly these hole cards",
    detail: args.shown.map((s) => s.cards.map(cardText).join("")).join(" · "),
    ok: handsOk,
  });
  return { checks, deck };
}
