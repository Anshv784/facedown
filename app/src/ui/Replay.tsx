import { useEffect, useMemo, useState } from "react";
import type { HandRecord, LogEntry, Street } from "../lib/types";
import { Card, Slot } from "./Card";

const BOARD_AT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

function verb(l: LogEntry) {
  const a = l.action;
  const amt = Number(l.bet).toLocaleString();
  const t = a.kind === "fold" ? "folds" : a.kind === "check" ? "checks" : a.kind === "call" ? `calls ${amt}` : a.kind === "raise" ? `raises to ${a.to.toLocaleString()}` : `is all-in for ${amt}`;
  return l.timed_out ? `${t} (timed out)` : t;
}

/** Step through a finished hand one action at a time. Every card shown here
 *  is public once the hand ends: the contract revealed the salt, rebuilt the
 *  deck and checked it. */
export function Replay({ record }: { record: HandRecord }) {
  const steps = record.log.length + 2; // deal, each action, showdown
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (i >= steps - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setI(i + 1), 900);
    return () => clearTimeout(t);
  }, [playing, i, steps]);

  const state = useMemo(() => {
    const bets = new Map<number, number>();
    const folded = new Set<number>();
    let street: Street = "preflop";
    let actor: number | null = null;
    let caption = "Cards dealt. Each player's two cards were sealed to their own key.";
    for (const l of record.log.slice(0, Math.max(0, i - 0))) {
      if (l.street !== street) {
        street = l.street;
        bets.clear();
      }
      bets.set(l.position, Number(l.bet));
      if (l.action.kind === "fold") folded.add(l.position);
      actor = l.position;
      const who = record.hands.find((h) => h.position === l.position)?.name ?? `Seat ${l.position}`;
      caption = `${who} ${verb(l)}`;
    }
    const end = i >= steps - 1;
    if (end) {
      caption =
        record.outcome.kind === "voided"
          ? "Hand voided: every chip went back."
          : record.hands
              .filter((h) => Number(h.won) > 0)
              .map((h) => `${h.name} wins ${Number(h.won).toLocaleString()}${record.outcome.kind === "showdown" ? ` with ${h.category.toLowerCase()}` : ""}`)
              .join(" · ");
      actor = null;
    }
    const shown = end ? record.board.length : Math.min(record.board.length, BOARD_AT[street]);
    return { bets, folded, street: end ? ("showdown" as const) : street, actor, caption, shown, end };
  }, [i, record, steps]);

  return (
    <div className="panel replay">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>Replay</b>
        <span className="faint" style={{ fontSize: 13, textTransform: "capitalize" }}>{state.street}</span>
      </div>
      <div style={{ background: "radial-gradient(ellipse at 50% 30%, var(--felt), var(--felt-3))", borderRadius: 14, padding: "18px 12px", display: "grid", justifyItems: "center", gap: 14 }}>
        <div className="board">
          {Array.from({ length: 5 }, (_, k) => (k < state.shown ? <Card key={k} card={record.board[k]} fresh /> : <Slot key={k} />))}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          {record.hands.map((h) => {
            const out = state.folded.has(h.position);
            const won = state.end && Number(h.won) > 0;
            return (
              <div key={h.position} className={`plate ${state.actor === h.position ? "turn" : ""} ${out ? "folded" : ""}`} style={{ minWidth: 104 }}>
                <div style={{ display: "flex", gap: 3, justifyContent: "center", marginBottom: 4 }}>
                  {h.cards.map((c, k) => (
                    <Card key={k} card={c} win={won} style={{ ["--w" as string]: "30px" }} />
                  ))}
                </div>
                <div className="who">{h.name}</div>
                <div className="tag move">{won ? `+${(Number(h.won) - Number(h.put_in)).toLocaleString()}` : state.bets.get(h.position) ? `bet ${state.bets.get(h.position)!.toLocaleString()}` : out ? "folded" : "\u00a0"}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="replay-caption">
        <b>{i + 1}/{steps}</b> · {state.caption}
      </div>
      <div className="replay-bar">
        <button className="btn small" onClick={() => setI(Math.max(0, i - 1))} aria-label="Previous step">‹</button>
        <button className="btn small primary" onClick={() => (i >= steps - 1 ? (setI(0), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? "Pause" : i >= steps - 1 ? "Replay" : "Play"}
        </button>
        <button className="btn small" onClick={() => setI(Math.min(steps - 1, i + 1))} aria-label="Next step">›</button>
        <input type="range" min={0} max={steps - 1} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Step" />
      </div>
    </div>
  );
}
