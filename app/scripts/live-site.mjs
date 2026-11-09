// Plays a hand through the deployed site's relayer (/api/relay, /api/advance),
// the same path the browser uses. usage: node scripts/live-site.mjs <table>
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { JsonRpcProvider } from "near-api-js";

const SITE = process.env.SITE ?? "https://facedown.anshverma.tech";
const C = "facedown.testnet";
const table = Number(process.argv[2] ?? 1);
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const view = (m, a) => provider.callFunction({ contractId: C, method: m, args: a });
const hex = (b) => Buffer.from(b).toString("hex");
const enc = new TextEncoder();
const sk = crypto.getRandomValues(new Uint8Array(32)), box = crypto.getRandomValues(new Uint8Array(32));
const me = hex(ed25519.getPublicKey(sk));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
let nonce = 0;
const post = (p, b) => fetch(SITE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
async function cmd(c) {
  const payload = JSON.stringify(c);
  const signature = hex(ed25519.sign(enc.encode(`facedown|${C}|${me}|${nonce}|${payload}`), sk));
  const r = await post("/api/relay", { player: me, nonce: String(nonce), payload, signature });
  if (!r.ok) throw new Error(`${c.do}: ${r.error}`);
  nonce = nonce === 0 ? 1 : nonce + 1;
  return r;
}
const open = (h, no) => {
  const epk = Buffer.from(h.epk, "hex");
  const key = sha256(new Uint8Array([...enc.encode("facedown/hole/v1"), ...x25519.getSharedSecret(box, epk), ...epk, ...x25519.getPublicKey(box)]));
  return [...chacha20poly1305(key, new Uint8Array(12), enc.encode(`facedown/${C}/${table}/${no}/${h.position}`)).decrypt(Buffer.from(h.ct, "hex"))];
};

await cmd({ do: "register", name: "live" + me.slice(0, 5), xpub: hex(x25519.getPublicKey(box)) });
for (let i = 0; i < 15 && !(await view("get_player", { id: me })); i++) await sleep(1000);
const rec = await view("get_player", { id: me });
log("registered via site:", rec.name, rec.chips);
nonce = rec.nonce;
const t = await view("get_table", { id: table });
const seat = t.seats.findIndex((s) => !s);
await cmd({ do: "sit", table, seat, buy_in: String(Number(t.big_blind) * 100) });
log("sat at seat", seat);
let lastNo = null, seen = "", acted = "";
for (let i = 0; i < 200; i++) {
  const tb = await view("get_table", { id: table });
  const h = tb.hand;
  if (!h) {
    if (lastNo) {
      const r = await view("get_hand", { table, hand: lastNo });
      log(`hand #${lastNo}:`, JSON.stringify(r.outcome), r.hands.map((x) => `${x.name} ${x.category || "fold"} won ${x.won}`).join(" | "));
      break;
    }
    await post("/api/advance", { table });
    await sleep(3000);
    continue;
  }
  lastNo = h.no;
  const s = `${h.betting.street} ${h.pending ? "dealer:" + h.pending.task.kind : "to_act " + h.betting.to_act} board ${h.board}`;
  if (s !== seen) { log(s); seen = s; }
  const myPos = h.ids.indexOf(me);
  const mine = h.holes.find((x) => x.position === myPos);
  if (mine && !globalThis.shown) { globalThis.shown = 1; log("my cards decrypted:", open(mine, h.no)); }
  if (h.pending) {
    if (h.pending.sent_ms === "0" || Date.now() - Number(h.pending.sent_ms) > 45000) await post("/api/advance", { table });
    await sleep(2500);
    continue;
  }
  const key = `${h.no}-${h.log.length}`;
  if (h.betting.to_act === myPos && acted !== key) {
    acted = key;
    const [, o] = await view("options", { table });
    await cmd({ do: "act", table, hand: h.no, action: o.can_check ? { kind: "check" } : { kind: "call" } });
  } else await sleep(2000);
}
await cmd({ do: "leave", table });
log("left; chips", (await view("get_player", { id: me })).chips);
