// A player is two keys made in this browser: an ed25519 key that signs
// commands and an x25519 key the dealer seals hole cards to. Neither ever
// leaves the device (unless the player exports a backup).

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { CONTRACT } from "./config";
import { hex, unhex, type Card } from "./poker";
import type { Command, SealedHole } from "./types";

export type Identity = { sign: string; box: string };

const KEY = `facedown.identity.v1.${CONTRACT}`;
const enc = new TextEncoder();

function read(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v.sign === "string" && typeof v.box === "string" ? v : null;
  } catch {
    return null;
  }
}

export function loadIdentity(): Identity | null {
  return read();
}

export function createIdentity(): Identity {
  const id: Identity = {
    sign: hex(crypto.getRandomValues(new Uint8Array(32))),
    box: hex(crypto.getRandomValues(new Uint8Array(32))),
  };
  saveIdentity(id);
  return id;
}

export function saveIdentity(id: Identity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* private mode: the identity lives for this tab only */
  }
}

export function forgetIdentity() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

export const playerId = (id: Identity) => hex(ed25519.getPublicKey(unhex(id.sign)));
export const xpubOf = (id: Identity) => hex(x25519.getPublicKey(unhex(id.box)));

export const exportBackup = (id: Identity) => `facedown1:${id.sign}:${id.box}`;
export function importBackup(text: string): Identity | null {
  const m = /^facedown1:([0-9a-f]{64}):([0-9a-f]{64})$/.exec(text.trim());
  return m ? { sign: m[1], box: m[2] } : null;
}

/** The exact bytes the contract verifies: facedown|contract|player|nonce|payload. */
export function signCommand(id: Identity, nonce: number, command: Command) {
  const player = playerId(id);
  const payload = JSON.stringify(command);
  const message = `facedown|${CONTRACT}|${player}|${nonce}|${payload}`;
  const signature = hex(ed25519.sign(enc.encode(message), unhex(id.sign)));
  return { player, nonce: String(nonce), payload, signature };
}

/** Opens this player's sealed hole cards. Mirrors `seal` in the dealer. */
export function openHole(id: Identity, sealed: SealedHole, table: number, hand: string): [Card, Card] | null {
  try {
    const epk = unhex(sealed.epk);
    const secret = unhex(id.box);
    const xpub = x25519.getPublicKey(secret);
    const shared = x25519.getSharedSecret(secret, epk);
    const material = new Uint8Array([...enc.encode("facedown/hole/v1"), ...shared, ...epk, ...xpub]);
    const key = sha256(material);
    const aad = enc.encode(`facedown/${CONTRACT}/${table}/${hand}/${sealed.position}`);
    const plain = chacha20poly1305(key, new Uint8Array(12), aad).decrypt(unhex(sealed.ct));
    return plain.length === 2 && plain[0] < 52 && plain[1] < 52 ? [plain[0], plain[1]] : null;
  } catch {
    return null;
  }
}
