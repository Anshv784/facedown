import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CONTRACT, EXPLORER } from "../lib/config";
import { chain } from "../lib/near";
import { auditHand, type Check } from "../lib/poker";
import type { DealerConfig, HandRecord } from "../lib/types";
import { Card, MiniCards } from "../ui/Card";

export function HandPage() {
  const tableId = Number(useParams().table);
  const no = useParams().hand ?? "";
  const [record, setRecord] = useState<HandRecord | null | undefined>(undefined);
  const [dealer, setDealer] = useState<DealerConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    Promise.all([chain.hand(tableId, no), chain.dealer()])
      .then(([h, d]) => {
        setRecord(h);
        setDealer(d);
      })
      .catch((e) => setErr(String(e?.message ?? e)));
  }, [tableId, no]);

  const audit = useMemo(() => {
    if (!record || !dealer || !record.vrf || !record.salt || !record.salt_commit) return null;
    try {
      return auditHand({
        vrfPubkey: dealer.vrf_pubkey,
        vrf: record.vrf,
        expectedSeed: `facedown-${tableId}-${record.no}`,
        salt: record.salt,
        saltCommit: record.salt_commit,
        players: record.hands.length,
        board: record.board,
        shown: record.hands.map((h) => ({ position: h.position, cards: h.cards })),
      });
    } catch (e) {
      return { checks: [{ label: "Audit could not run", detail: String(e), ok: false }] as Check[], deck: null };
    }
  }, [record, dealer, tableId]);

  // Reveal checks one by one so the reader can follow along.
  useEffect(() => {
    if (!audit) return;
    setShown(0);
    const t = setInterval(() => setShown((s) => (s >= audit.checks.length ? s : s + 1)), 380);
    return () => clearInterval(t);
  }, [audit]);

  if (err) return <main className="prose"><h1>Couldn't load hand.</h1><p className="error">{err}</p></main>;
  if (record === undefined) return <main className="prose"><p className="faint">Fetching hand #{no} from NEAR…</p></main>;
  if (record === null) return <main className="prose"><h1>Hand #{no} isn't finished yet.</h1><Link to={`/t/${tableId}`}>Back to the table</Link></main>;

  const voided = record.outcome.kind === "voided";
  const allOk = audit?.checks.every((c) => c.ok) ?? false;
  const done = audit && shown >= audit.checks.length;
  const deck = audit?.deck ?? null;
  const n = record.hands.length;
  const where = (i: number) => (i < 2 * n ? record.hands.find((h) => h.position === Math.floor(i / 2))?.name ?? `P${Math.floor(i / 2)}` : i < 2 * n + 5 ? ["flop", "flop", "flop", "turn", "river"][i - 2 * n] : null);

  return (
    <main className="verify">
      <div>
        <Link to={`/t/${tableId}`} className="faint" style={{ fontSize: 13, textDecoration: "none" }}>
          ← Table {tableId}
        </Link>
        <div className="eyebrow" style={{ marginTop: 18 }}>
          Independent audit · runs in your browser
        </div>
        <h1>Hand #{record.no}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Everything below is recomputed on this page from public data on NEAR, with no help from our servers. If the dealer had
          swapped a single card, one of these checks would fail.
        </p>

        {voided && (
          <div className="panel verdict no">
            <span className="mark no">!</span>
            <div>
              <strong>This hand was voided and every chip went back.</strong>
              <div className="muted" style={{ fontSize: 14 }}>{(record.outcome as { reason: string }).reason}</div>
            </div>
          </div>
        )}
        {done && !voided && (
          <div className={`panel verdict ${allOk ? "ok" : "no"}`}>
            <span className={`mark ${allOk ? "ok" : "no"}`}>{allOk ? "✓" : "✕"}</span>
            <div>
              <strong>{allOk ? "Every card checks out." : "This hand fails the audit."}</strong>
              <div className="muted" style={{ fontSize: 14 }}>
                {allOk ? "The deck was fixed by randomness nobody chose, before anyone saw a card." : "The contract would have refused to pay this hand."}
              </div>
            </div>
          </div>
        )}

        {audit && (
          <ol className="checks">
            {audit.checks.map((c, i) => (
              <li key={i} className="panel">
                <span className={`mark ${i < shown ? (c.ok ? "ok" : "no") : "wait"}`}>{i < shown ? (c.ok ? "✓" : "✕") : i + 1}</span>
                <div>
                  <div style={{ fontWeight: 500 }}>{c.label}</div>
                  <div className="hash" style={{ marginTop: 3 }}>{c.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        )}

        <h2 className="serif" style={{ fontWeight: 400, fontSize: 28, margin: "32px 0 12px" }}>Who held what</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {record.hands.map((h) => (
            <div key={h.position} className="panel" style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {h.cards.map((c, i) => (
                  <Card key={i} card={c} dim={h.folded} style={{ ["--w" as string]: "36px" }} />
                ))}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{h.name}</div>
                <div className="faint" style={{ fontSize: 13 }}>{h.folded ? "folded" : h.category}</div>
              </div>
              <div className="mono" style={{ textAlign: "right", fontSize: 13 }}>
                {Number(h.won) > 0 ? <span style={{ color: "var(--good)" }}>won {Number(h.won).toLocaleString()}</span> : <span className="faint">put in {Number(h.put_in).toLocaleString()}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="panel" style={{ padding: 20 }}>
          <div className="eyebrow">The whole deck, rebuilt</div>
          <p className="muted" style={{ fontSize: 14, margin: "6px 0 16px" }}>
            shuffle(sha256("facedown/deck/v1" ‖ vrf ‖ salt)), in deal order. Labelled cards were dealt; the rest stayed in the deck.
          </p>
          {deck ? (
            <div className="deckgrid">
              {deck.map((c, i) => (
                <div className="cell" key={i}>
                  <Card card={c} dim={where(i) === null} />
                  {where(i) && <span className="pos">{where(i)!.slice(0, 5)}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="faint">{voided ? "No deck to rebuild: the dealer's secret was never accepted." : "Loading…"}</p>
          )}
        </div>

        <div className="panel" style={{ padding: 20, marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Raw data</div>
          <dl className="kv mono">
            <dt>board</dt>
            <dd><MiniCards cards={record.board} /></dd>
            <dt>pot</dt>
            <dd>{Number(record.pot).toLocaleString()}</dd>
            <dt>vrf output</dt>
            <dd>{record.vrf?.output ?? "—"}</dd>
            <dt>vrf signature</dt>
            <dd>{record.vrf?.signature ?? "—"}</dd>
            <dt>alpha</dt>
            <dd>{record.vrf?.alpha ?? "—"}</dd>
            <dt>vrf key</dt>
            <dd>{dealer?.vrf_pubkey}</dd>
            <dt>salt commit</dt>
            <dd>{record.salt_commit ?? "—"}</dd>
            <dt>salt</dt>
            <dd>{record.salt ?? "—"}</dd>
            <dt>dealer</dt>
            <dd>{dealer?.project_id}</dd>
            <dt>contract</dt>
            <dd>
              <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT}</a>
            </dd>
          </dl>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 14, marginBottom: 0 }}>
            Check it without this site: <code className="mono">near contract call-function as-read-only {CONTRACT} get_hand json-args '{`{"table":${tableId},"hand":"${record.no}"}`}' network-config testnet now</code>
          </p>
        </div>
      </div>
    </main>
  );
}
