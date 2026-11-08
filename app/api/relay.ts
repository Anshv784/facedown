import { call, errorText, json } from "./_near.js";

const HEX = /^[0-9a-f]+$/;

export async function POST(request: Request) {
  let body: { player?: unknown; nonce?: unknown; payload?: unknown; signature?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "expected JSON" }, 400);
  }
  const { player, nonce, payload, signature } = body;
  // Cheap checks here; the contract does the real ones (signature, nonce).
  if (
    typeof player !== "string" || player.length !== 64 || !HEX.test(player) ||
    typeof signature !== "string" || signature.length !== 128 || !HEX.test(signature) ||
    typeof nonce !== "string" || !/^\d{1,15}$/.test(nonce) ||
    typeof payload !== "string" || payload.length > 600
  ) {
    return json({ ok: false, error: "malformed command" }, 400);
  }
  try {
    const { tx, error } = await call("relay", { player, nonce, payload, signature });
    return error ? json({ ok: false, error: errorText(error), tx }, 200) : json({ ok: true, tx });
  } catch (e) {
    return json({ ok: false, error: errorText(e) }, 502);
  }
}
