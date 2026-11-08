import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import vectors from "./vectors.json";
import { auditHand, board, categoryOf, deckSeed, evaluate, hex, hole, parseCard, saltCommitment, shuffle, unhex } from "./poker";

describe("matches the Rust core", () => {
  it("pinned shuffle vector", () => {
    const deck = shuffle(deckSeed(new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)));
    expect(deck.slice(0, 5)).toEqual([16, 45, 3, 9, 37]);
  });
  it("every deck and salt commitment Rust produced", () => {
    for (const d of vectors.decks) {
      expect(shuffle(deckSeed(unhex(d.vrf), unhex(d.salt)))).toEqual(d.deck);
      expect(hex(saltCommitment(unhex(d.salt)))).toBe(d.commit);
    }
  });
  it("every hand score Rust produced", () => {
    for (const h of vectors.hands) expect(evaluate(h.cards)).toBe(h.score);
  });
  it("names hands", () => {
    expect(categoryOf(evaluate("As Ks Qs Js Ts 2c 3d".split(" ").map(parseCard)))).toBe("Straight flush");
    expect(categoryOf(evaluate("Ac 2d 3h 4s 5d Kc Kd".split(" ").map(parseCard)))).toBe("Straight");
  });
});

describe("audit", () => {
  const sk = new Uint8Array(32).fill(3);
  const pk = hex(ed25519.getPublicKey(sk));
  const alpha = "vrf:42:facedown.testnet:facedown-0-7";
  const sig = ed25519.sign(new TextEncoder().encode(alpha), sk);
  const vrf = { output: hex(sha256(sig)), signature: hex(sig), alpha };
  const salt = new Uint8Array(32).fill(9);
  const deck = shuffle(deckSeed(unhex(vrf.output), salt));
  const base = {
    vrfPubkey: pk,
    vrf,
    expectedSeed: "facedown-0-7",
    salt: hex(salt),
    saltCommit: hex(saltCommitment(salt)),
    players: 3,
    board: board(deck, 3),
    shown: [0, 1, 2].map((p) => ({ position: p, cards: hole(deck, p) })),
  };
  it("passes an honest hand", () => {
    expect(auditHand(base).checks.every((c) => c.ok)).toBe(true);
  });
  it("catches a swapped salt, a forged VRF, a wrong board and a wrong hand", () => {
    const fails = (o: object) => auditHand({ ...base, ...o }).checks.filter((c) => !c.ok).length;
    expect(fails({ salt: hex(new Uint8Array(32).fill(8)) })).toBeGreaterThan(0);
    expect(fails({ vrf: { ...vrf, output: hex(new Uint8Array(32)) } })).toBeGreaterThan(0);
    expect(fails({ expectedSeed: "facedown-0-8" })).toBe(1);
    expect(fails({ board: [...base.board.slice(0, 4), (base.board[4] + 1) % 52] })).toBe(1);
    expect(fails({ shown: [{ position: 0, cards: hole(deck, 1) }] })).toBe(1);
  });
});
