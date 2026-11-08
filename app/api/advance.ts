import { call, errorText, json } from "./_near.js";

// Many browsers watch a table; only one nudge per table every few seconds
// is useful. Per-instance memory is enough to drop most duplicates.
const last = new Map<number, number>();

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const table = Number((body as { table?: unknown }).table);
  if (!Number.isInteger(table) || table < 0 || table > 10_000) return json({ ok: false, error: "bad table" }, 400);
  const now = Date.now();
  if (now - (last.get(table) ?? 0) < 2500) return json({ ok: true, skipped: true });
  last.set(table, now);
  try {
    const { tx, error } = await call("advance", { table });
    return json({ ok: !error, tx, error: error ? errorText(error) : undefined });
  } catch (e) {
    return json({ ok: false, error: errorText(e) }, 502);
  }
}
