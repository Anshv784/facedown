import { signCommand, type Identity } from "./identity";
import type { Command } from "./types";

async function post(path: string, body: object): Promise<{ ok: boolean; error?: string; tx?: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `relayer answered ${res.status}` }));
  return json;
}

/** Signs a command in the browser and hands it to the relayer to submit. */
export async function send(id: Identity, nonce: number, command: Command) {
  const r = await post("/api/relay", signCommand(id, nonce, command));
  if (!r.ok) throw new Error(cleanError(r.error ?? "the relayer failed"));
  return r.tx;
}

/** Asks the relayer to nudge a table (start a hand, retry the dealer, play a timeout). */
export const advance = (table: number) => post("/api/advance", { table }).catch(() => ({ ok: false }));

export function cleanError(e: string) {
  const m = /Smart contract panicked: (.*?)(\\n|"|$)/.exec(e);
  return (m ? m[1] : e).replace(/^.*?panicked at [^:]+:\d+:\d+:\s*/, "");
}
