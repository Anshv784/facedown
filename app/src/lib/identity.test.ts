import { describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import v from "./seal-vector.json";

vi.mock("./config", () => ({ CONTRACT: "facedown.testnet" }));
const { openHole, signCommand, playerId } = await import("./identity");
const { unhex } = await import("./poker");

describe("identity", () => {
  const id = { sign: "01".repeat(32), box: v.box };
  it("opens hole cards the Rust dealer sealed", () => {
    const sealed = { position: v.position, seat: 0, epk: v.epk, ct: v.ct };
    expect(openHole(id, sealed, v.table, v.hand)).toEqual(v.cards);
    // Same ciphertext, another hand or seat: refused.
    expect(openHole(id, sealed, v.table, "42")).toBeNull();
    expect(openHole(id, { ...sealed, position: 1 }, v.table, v.hand)).toBeNull();
    expect(openHole({ ...id, box: "06".repeat(32) }, sealed, v.table, v.hand)).toBeNull();
  });
  it("signs the exact message the contract checks", () => {
    const s = signCommand(id, 3, { do: "claim" });
    const msg = `facedown|facedown.testnet|${playerId(id)}|3|{"do":"claim"}`;
    expect(ed25519.verify(unhex(s.signature), new TextEncoder().encode(msg), unhex(s.player))).toBe(true);
  });
});
