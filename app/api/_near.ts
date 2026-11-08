// Server side of the relayer. It holds a function-call key on the table
// contract that can only call `relay` and `advance`, so the worst a leaked
// key can do is spend its small gas allowance. It can't move chips: every
// player command still has to carry the player's own signature.

import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";

export const CONTRACT = process.env.FACEDOWN_CONTRACT ?? "facedown.testnet";
const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const provider = new JsonRpcProvider({ url: RPC });

let account: Account | null = null;
function signer(): Account {
  const key = process.env.RELAYER_KEY;
  if (!key) throw new Error("relayer key is not configured");
  account ??= new Account(process.env.RELAYER_ACCOUNT ?? CONTRACT, provider, key as KeyPairString);
  return account;
}

type Outcome = { status: Record<string, unknown>; executor_id: string };

/** Sends a call and waits only for the contract's own receipt, not for the
 *  dealer callback it may start (that can take several seconds). */
export async function call(method: string, args: object) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await signer().callFunctionRaw({
        contractId: CONTRACT,
        methodName: method,
        args,
        gas: teraToGas("300"),
        waitUntil: "INCLUDED",
      });
      const hash = res.transaction?.hash ?? (res as { transaction_outcome?: { id: string } }).transaction_outcome?.id;
      return { tx: hash, error: hash ? await firstFailure(hash) : null };
    } catch (e) {
      lastErr = e;
      if (!/nonce/i.test(String(e))) break;
    }
  }
  throw lastErr;
}

async function firstFailure(hash: string): Promise<string | null> {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tx",
        params: { tx_hash: hash, sender_account_id: process.env.RELAYER_ACCOUNT ?? CONTRACT, wait_until: "NONE" },
      }),
    }).then((r) => r.json());
    const outcomes: { outcome: Outcome }[] = res.result?.receipts_outcome ?? [];
    const mine = outcomes.find((o) => o.outcome.executor_id === CONTRACT);
    if (!mine) continue;
    const failure = mine.outcome.status.Failure as Record<string, unknown> | undefined;
    if (!failure) return null;
    return JSON.stringify(failure);
  }
  return null;
}

export function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function errorText(e: unknown) {
  const s = typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
  const m = /Smart contract panicked: ([^"\\]*)/.exec(s);
  return m ? m[1] : s.slice(0, 300);
}
