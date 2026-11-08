import { Link } from "react-router-dom";
import type { Hand, HandRecord, Table } from "../lib/types";
import { MiniCards } from "./Card";

type Step = { title: string; detail: React.ReactNode; state: "done" | "now" | "todo" | "bad" };

const short = (h: string | null | undefined, n = 20) => (h ? `${h.slice(0, n)}…${h.slice(-6)}` : "");

/**
 * The hand's trail, step by step: where the randomness came from, what the
 * dealer locked in before anyone saw a card, who each sealed hand belongs to,
 * what was revealed, and the audit at the end.
 */
export function Custody({ table, hand, record }: { table: Table; hand: Hand | null; record: HandRecord | null }) {
  if (!hand && !record) {
    return <p className="faint" style={{ fontSize: 13 }}>The trail of the next hand will appear here as it's dealt.</p>;
  }
  const no = hand?.no ?? record!.no;
  const vrf = hand?.vrf ?? record?.vrf ?? null;
  const commit = hand?.salt_commit ?? record?.salt_commit ?? null;
  const board = hand?.board ?? record?.board ?? [];
  const task = hand?.pending?.task;
  const players = hand ? hand.ids.length : record!.hands.length;
  const steps: Step[] = [];

  steps.push({
    title: `Hand #${no} begins`,
    detail: `${players} players dealt in · seed "facedown-${table.id}-${no}"`,
    state: "done",
  });

  steps.push({
    title: "Randomness drawn from OutLayer's VRF",
    detail: vrf ? (
      <>
        The contract checked the ed25519 proof against OutLayer's key before accepting it.
        <div className="hash">
          <b>output</b> {short(vrf.output, 24)}
          <br />
          <b>alpha</b> {vrf.alpha}
        </div>
      </>
    ) : (
      "Waiting for the enclave to draw it."
    ),
    state: vrf ? "done" : task?.kind === "deal" ? "now" : record ? "bad" : "todo",
  });

  steps.push({
    title: "Dealer locked in its secret",
    detail: commit ? (
      <>
        A hash of the dealer's secret salt, posted before any card was seen. The salt can't change after this.
        <div className="hash">
          <b>commit</b> {short(commit, 24)}
        </div>
      </>
    ) : (
      "Not yet."
    ),
    state: commit ? "done" : task?.kind === "deal" ? "now" : record ? "bad" : "todo",
  });

  const sealed = hand?.holes ?? [];
  steps.push({
    title: "Hole cards sealed to each player",
    detail:
      hand && sealed.length ? (
        <>
          Encrypted to each player's x25519 key with ChaCha20-Poly1305. Bots' cards never leave the enclave.
          <div className="hash">
            {sealed.map((h) => (
              <div key={h.position}>
                <b>{table.seats[h.seat]?.name ?? `seat ${h.seat}`}</b> {short(h.ct, 18)}
              </div>
            ))}
          </div>
        </>
      ) : record ? (
        "Sealed during the hand; revealed below now that it's over."
      ) : (
        "Not yet."
      ),
    state: (hand && sealed.length) || (record && vrf) ? "done" : task?.kind === "deal" ? "now" : "todo",
  });

  const streets: [string, number, number][] = [
    ["Flop", 0, 3],
    ["Turn", 3, 4],
    ["River", 4, 5],
  ];
  for (const [name, from, to] of streets) {
    const shown = board.length >= to;
    const now = task?.kind === "board" && task.street === name.toLowerCase();
    if (!shown && !now && (record || !hand)) continue;
    steps.push({
      title: `${name} revealed`,
      detail: shown ? <MiniCards cards={board.slice(from, to)} /> : now ? "The enclave is re-deriving the deck to reveal it." : "Not yet.",
      state: shown ? "done" : now ? "now" : "todo",
    });
  }

  if (record) {
    const voided = record.outcome.kind === "voided";
    steps.push({
      title: voided ? "Hand voided, all chips returned" : "Secret revealed and deck audited",
      detail: voided ? (
        (record.outcome as { reason: string }).reason
      ) : (
        <>
          The contract rebuilt the deck from the VRF output and the salt, matched the commitment, the board and every
          hand, then paid out.
          <div className="hash">
            <b>salt</b> {short(record.salt, 24)}
          </div>
          <Link to={`/t/${table.id}/h/${record.no}`} className="mono" style={{ fontSize: 12, color: "var(--good)" }}>
            Re-run the audit in your browser →
          </Link>
        </>
      ),
      state: voided ? "bad" : "done",
    });
  } else {
    steps.push({
      title: "Secret revealed and deck audited",
      detail: task?.kind === "finish" ? "The enclave is revealing the salt now." : "Happens the moment the hand ends.",
      state: task?.kind === "finish" ? "now" : "todo",
    });
  }

  return (
    <ol className="custody">
      {steps.map((s, i) => (
        <li key={i} className={s.state}>
          <div className="t">{s.title}</div>
          <div className="d">{s.detail}</div>
        </li>
      ))}
    </ol>
  );
}
