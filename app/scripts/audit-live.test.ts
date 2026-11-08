import { expect, it } from "vitest";
import { auditHand } from "../src/lib/poker";

const rpc = async (method: string, args: object) => {
  const r = await fetch("https://test.rpc.fastnear.com", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "facedown.testnet", method_name: method, args_base64: btoa(JSON.stringify(args)) } }) }).then((r) => r.json());
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)));
};

it.skipIf(!process.env.LIVE)("live hand passes the browser audit", async () => {
  const table = Number(process.env.T ?? 1), hand = process.env.H ?? "1";
  const [h, d] = await Promise.all([rpc("get_hand", { table, hand }), rpc("dealer_config", {})]);
  const { checks } = auditHand({ vrfPubkey: d.vrf_pubkey, vrf: h.vrf, expectedSeed: `facedown-${table}-${h.no}`, salt: h.salt, saltCommit: h.salt_commit, players: h.hands.length, board: h.board, shown: h.hands.map((x: any) => ({ position: x.position, cards: x.cards })) });
  for (const c of checks) console.log(c.ok ? "✓" : "✗", c.label);
  expect(checks.every((c) => c.ok)).toBe(true);
}, 20000);
