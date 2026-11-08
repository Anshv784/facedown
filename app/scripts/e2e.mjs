// End-to-end check against the live contract + OutLayer dealer:
// registers a fresh player, sits at a table, and plays hands to completion
// through the same relayer key the web app uses.
// usage: node scripts/e2e.mjs <table> [hands]
import { Account, JsonRpcProvider, teraToGas } from "near-api-js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const C = "facedown.testnet";
const table = Number(process.argv[2] ?? 1);
const hands = Number(process.argv[3] ?? 1);
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const relayer = new Account(C, provider, readFileSync(homedir() + "/facedown/.relayer-key", "utf8").trim());
const hex = (b) => Buffer.from(b).toString("hex");
const enc = new TextEncoder();
const sk = crypto.getRandomValues(new Uint8Array(32));
const box = crypto.getRandomValues(new Uint8Array(32));
const me = hex(ed25519.getPublicKey(sk));
let nonce = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const view = (m, a) => provider.callFunction({ contractId: C, method: m, args: a });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

async function call(method, args) {
  const r = await relayer.callFunctionRaw({ contractId: C, methodName: method, args, gas: teraToGas("300"), waitUntil: "EXECUTED_OPTIMISTIC" }).catch((e) => ({ err: String(e) }));
  if (r.err) throw new Error(r.err.slice(0, 400));
  const fail = r.receipts_outcome?.map((o) => o.outcome.status.Failure).find(Boolean);
  if (fail) log("  receipt failure:", JSON.stringify(fail).slice(0, 300));
  return r;
}
async function cmd(c) {
  const payload = JSON.stringify(c);
  const sig = ed25519.sign(enc.encode(`facedown|${C}|${me}|${nonce}|${payload}`), sk);
  await call("relay", { player: me, nonce: String(nonce), payload, signature: hex(sig) });
  nonce = nonce === 0 ? 1 : nonce + 1;
}
function open(h, no) {
  const epk = Buffer.from(h.epk, "hex");
  const xpub = x25519.getPublicKey(box);
  const key = sha256(new Uint8Array([...enc.encode("facedown/hole/v1"), ...x25519.getSharedSecret(box, epk), ...epk, ...xpub]));
  return [...chacha20poly1305(key, new Uint8Array(12), enc.encode(`facedown/${C}/${table}/${no}/${h.position}`)).decrypt(Buffer.from(h.ct, "hex"))];
}

await cmd({ do: "register", name: "e2e" + me.slice(0, 6), xpub: hex(x25519.getPublicKey(box)) });
const rec = await view("get_player", { id: me });
log("registered", rec.name, rec.chips, "nonce", rec.nonce);
nonce = rec.nonce;
const t = await view("get_table", { id: table });
const seat = t.seats.findIndex((s) => !s);
await cmd({ do: "sit", table, seat, buy_in: String(Number(t.big_blind) * 100) });
log("sat at seat", seat);

let done = 0, lastNo = null, lastSeen = "";
for (let i = 0; i < 400 && done < hands; i++) {
  const tb = await view("get_table", { id: table });
  const h = tb.hand;
  if (!h) {
    if (lastNo) {
      const rec = await view("get_hand", { table, hand: lastNo });
      log(`hand #${lastNo} ->`, JSON.stringify(rec.outcome), "board", rec.board, rec.hands.map((x) => `${x.name}:${x.cards}:${x.category}:won ${x.won}`).join(" | "));
      done++; lastNo = null;
      if (done >= hands) break;
    }
    await call("advance", { table }); await sleep(1500); continue;
  }
  lastNo = h.no;
  const state = `${h.no}/${h.betting.street}/${h.pending ? h.pending.task.kind + ":" + h.pending.sent_ms + ":" + h.pending.attempts : "to_act " + h.betting.to_act}/${h.board}`;
  if (state !== lastSeen) { log("state", state); lastSeen = state; }
  const myPos = h.ids.indexOf(me);
  const mine = h.holes.find((x) => x.position === myPos);
  if (mine && !globalThis[`seen${h.no}`]) { globalThis[`seen${h.no}`] = 1; log("my cards (decrypted):", open(mine, h.no)); }
  if (h.pending) {
    if (h.pending.sent_ms === "0" || Date.now() - Number(h.pending.sent_ms) > 45000) await call("advance", { table });
    await sleep(2000); continue;
  }
  if (h.betting.to_act === myPos) {
    const [, o] = await view("options", { table });
    await cmd({ do: "act", table, hand: h.no, action: o.can_check ? { kind: "check" } : { kind: "call" } });
  } else await sleep(1500);
}
await cmd({ do: "leave", table });
log("left; chips now", (await view("get_player", { id: me })).chips);
