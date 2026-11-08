import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { openHole } from "../lib/identity";
import { chain } from "../lib/near";
import { usePlayer, usePoll } from "../lib/player";
import { advance } from "../lib/relay";
import type { Action, Hand, HandRecord, LogEntry, Options, Seat, Table } from "../lib/types";
import { Card, MiniCards, Slot } from "../ui/Card";
import { Custody } from "../ui/Custody";
import type { Card as C } from "../lib/poker";

const ACTION_TIMEOUT_MS = 30_000;
const DEALER_RETRY_MS = 45_000;

export function TablePage() {
  const tableId = Number(useParams().table);
  const { id: me, record, run, busy } = usePlayer();
  const { data: table, error } = usePoll(() => chain.table(tableId), 1000, [tableId]);
  const lastHand = table?.last_hand ?? null;
  const { data: recent } = usePoll(() => chain.recent(tableId, 12), 6000, [tableId, lastHand]);
  const [tab, setTab] = useState<"custody" | "action" | "history">("custody");
  const [buyIn, setBuyIn] = useState<number | null>(null);
  const now = useNow();

  const hand = table?.hand ?? null;
  const mySeat = table?.seats.findIndex((s) => s?.player === me) ?? -1;
  const myPos = hand && me ? hand.ids.indexOf(me) : -1;
  const last = recent?.[0] ?? null;
  const showResult = !hand && last && last.no === lastHand;

  const myCards = useHoleCards(hand, myPos, tableId);
  const options = useMyOptions(table, myPos);
  useAutoAdvance(table, last, now);

  if (error && !table) return <main className="prose"><h1>Can't load this table.</h1><p className="error">{error}</p></main>;
  if (!table) return <main className="prose"><p className="faint">Loading table…</p></main>;

  const seatOrigin = mySeat >= 0 ? mySeat : 0;
  const n = table.max_seats;
  const sat = mySeat >= 0 ? table.seats[mySeat] : null;

  return (
    <main className="room">
      <div>
        <div className="room-head">
          <div>
            <Link to="/" className="faint" style={{ fontSize: 13, textDecoration: "none" }}>
              ← Tables
            </Link>
            <h1>{table.name}</h1>
            <div className="faint mono" style={{ fontSize: 12, marginTop: 4 }}>
              Blinds {Number(table.small_blind)}/{Number(table.big_blind)} · {Number(table.hands_dealt)} hands
              {hand ? ` · hand #${hand.no}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {sat?.sitting_out && (
              <button className="btn small primary" disabled={busy} onClick={() => run({ do: "sit_in", table: tableId })}>
                I'm back
              </button>
            )}
            {sat && (
              <button className="btn small ghost" disabled={busy || sat.leaving} onClick={() => run({ do: "leave", table: tableId })}>
                {sat.leaving ? "Leaving after this hand" : "Leave table"}
              </button>
            )}
          </div>
        </div>

        <div className="stage">
          <div className="felt" />
          <Center table={table} hand={hand} result={showResult ? last : null} />
          {table.seats.map((seat, i) => {
            const angle = Math.PI / 2 + ((i - seatOrigin) * 2 * Math.PI) / n;
            return (
              <SeatView
                key={i}
                index={i}
                angle={angle}
                seat={seat}
                table={table}
                hand={hand}
                result={showResult ? last : null}
                me={me}
                myCards={myCards}
                now={now}
                canSit={!!record && mySeat < 0}
                onSit={() => setBuyIn(i)}
              />
            );
          })}
        </div>

        {hand && myPos >= 0 && options && options[0] === myPos && !hand.pending && (
          <ActionBar key={`${hand.no}-${hand.log.length}`} hand={hand} options={options[1]} onAct={(action) => run({ do: "act", table: tableId, hand: hand.no, action })} busy={busy} />
        )}
        {!record && (
          <div className="panel actionbar">
            <span className="muted grow">Watching. Join from the lobby to take a seat.</span>
            <Link to="/" className="btn small primary">
              Join
            </Link>
          </div>
        )}
      </div>

      <aside className="panel ledger">
        <div className="tabs" role="tablist">
          {(["custody", "action", "history"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "custody" ? "Custody" : t === "action" ? "Action" : "Past hands"}
            </button>
          ))}
        </div>
        <div className="ledger-body">
          {tab === "custody" && <Custody table={table} hand={hand} record={hand ? null : last} />}
          {tab === "action" && <Feed table={table} hand={hand} record={hand ? null : last} />}
          {tab === "history" && <History table={tableId} hands={recent ?? []} />}
        </div>
      </aside>

      {buyIn !== null && record && (
        <BuyIn
          table={table}
          chips={record.chips}
          onClose={() => setBuyIn(null)}
          onSit={async (amount) => {
            const ok = await run({ do: "sit", table: tableId, seat: buyIn, buy_in: String(amount) });
            if (ok) setBuyIn(null);
          }}
          busy={busy}
        />
      )}
    </main>
  );
}

// ---------- hooks ----------

function useNow(ms = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function useHoleCards(hand: Hand | null, myPos: number, tableId: number) {
  const { identity } = usePlayer();
  const sealed = hand && myPos >= 0 ? hand.holes.find((h) => h.position === myPos) : undefined;
  return useMemo(() => {
    if (!identity || !sealed || !hand) return null;
    return openHole(identity, sealed, tableId, hand.no);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, sealed?.ct, hand?.no, tableId]);
}

function useMyOptions(table: Table | null, myPos: number) {
  const hand = table?.hand;
  const myTurn = !!hand && !hand.pending && hand.betting.to_act === myPos && myPos >= 0;
  const key = hand ? `${hand.no}-${hand.log.length}-${hand.board.length}` : "";
  const [opts, setOpts] = useState<[number, Options] | null>(null);
  useEffect(() => {
    if (!myTurn || !table) {
      setOpts(null);
      return;
    }
    let live = true;
    chain.options(table.id).then((o) => live && setOpts(o)).catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, key]);
  return opts;
}

/** Tables move only when someone calls `advance`; every open browser helps. */
function useAutoAdvance(table: Table | null, last: HandRecord | null, now: number) {
  const lastCall = useRef(0);
  useEffect(() => {
    if (!table || now - lastCall.current < 3000) return;
    const hand = table.hand;
    let due = false;
    if (!hand) {
      const ready = table.seats.filter((s) => s && s.stack > 0 && !s.sitting_out && !s.leaving);
      const human = ready.some((s) => !s!.bot);
      const rested = !last || now - Number(last.ended_ms) > 5000;
      due = ready.length >= 2 && human && rested;
    } else if (hand.pending) {
      const sent = Number(hand.pending.sent_ms);
      due = sent === 0 || now - sent > DEALER_RETRY_MS;
    } else {
      due = now > Number(hand.deadline_ms) + 1000;
    }
    if (due) {
      lastCall.current = now;
      advance(table.id);
    }
  }, [table, last, now]);
}

// ---------- table pieces ----------

function dealerText(table: Table, hand: Hand): string | null {
  const p = hand.pending;
  if (!p) return null;
  const retry = p.attempts > 0 ? ` (retry ${p.attempts}/3)` : "";
  switch (p.task.kind) {
    case "deal":
      return `Shuffling inside the enclave and sealing each player's cards to their key${retry}`;
    case "board":
      return `Dealer is revealing the ${p.task.street}${retry}`;
    case "finish":
      return `Dealer is revealing its secret so the contract can audit the deck${retry}`;
    case "bot": {
      const seat = table.seats[hand.betting.players[p.task.position].seat];
      return `${seat?.name ?? "Bot"} is thinking inside the enclave${retry}`;
    }
  }
}

function Center({ table, hand, result }: { table: Table; hand: Hand | null; result: HandRecord | null }) {
  const board: C[] = hand?.board ?? result?.board ?? [];
  const pot = hand ? hand.betting.players.reduce((s, p) => s + p.total, 0) : 0;
  const status = hand ? dealerText(table, hand) : null;
  const prev = useRef(0);
  const fresh = board.length > prev.current ? prev.current : 99;
  useEffect(() => {
    prev.current = board.length;
  });
  const winners = result?.hands.filter((h) => Number(h.won) > 0) ?? [];
  return (
    <div className="center">
      <div className="board">
        {Array.from({ length: 5 }, (_, i) =>
          board[i] !== undefined ? <Card key={`${hand?.no ?? result?.no}-${i}`} card={board[i]} fresh={i >= fresh} /> : <Slot key={i} />,
        )}
      </div>
      {hand && (
        <div className="pot">
          <small>Pot</small>
          {pot.toLocaleString()}
        </div>
      )}
      {result && (
        <div className="pot" style={{ fontSize: 20, textAlign: "center" }}>
          {result.outcome.kind === "voided" ? (
            <span style={{ color: "var(--warn)" }}>Hand voided, every chip returned</span>
          ) : (
            winners.map((w) => (
              <div key={w.position}>
                {w.name} wins {Number(w.won).toLocaleString()}
                {result.outcome.kind === "showdown" ? <span className="faint"> · {w.category}</span> : null}
              </div>
            ))
          )}
          <Link to={`/t/${table.id}/h/${result.no}`} className="mono" style={{ display: "inline-block", fontSize: 12, marginTop: 6, color: "var(--good)" }}>
            {result.outcome.kind === "voided" ? "see why →" : "audited on chain ✓ verify it yourself →"}
          </Link>
        </div>
      )}
      {status && (
        <div className="dealer-status" aria-live="polite">
          <span className="pulse" />
          {status}
        </div>
      )}
      {!hand && !result && (
        <div className="dealer-status">
          {table.seats.filter(Boolean).length < 2 ? "Waiting for players" : "Next hand starting…"}
        </div>
      )}
    </div>
  );
}

function SeatView(props: {
  index: number;
  angle: number;
  seat: Seat | null;
  table: Table;
  hand: Hand | null;
  result: HandRecord | null;
  me: string | null;
  myCards: [C, C] | null;
  now: number;
  canSit: boolean;
  onSit: () => void;
}) {
  const { index, angle, seat, table, hand, result, me, myCards, now } = props;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pos = { left: `${50 + 43 * cos}%`, top: `${50 + 41 * sin}%` };
  if (!seat) {
    return (
      <div className="seat" style={pos}>
        {props.canSit ? (
          <button className="empty-seat" onClick={props.onSit}>
            Sit here
          </button>
        ) : (
          <div className="empty-seat" style={{ display: "grid", placeItems: "center", cursor: "default" }}>
            Open seat
          </div>
        )}
      </div>
    );
  }
  const p = hand ? hand.betting.players.findIndex((bp) => bp.seat === index) : -1;
  const bp = p >= 0 ? hand!.betting.players[p] : null;
  const isMe = seat.player === me;
  const toAct = !!hand && !hand.pending && hand.betting.to_act === p && p >= 0;
  const botThinking = hand?.pending?.task.kind === "bot" && hand.pending.task.position === p;
  const shown = result?.hands.find((h) => h.seat === index);
  const stack = bp ? bp.stack : seat.stack;
  const lastMove = hand && p >= 0 ? [...hand.log].reverse().find((l) => l.position === p && l.street === hand.betting.street) : undefined;
  const left = toAct ? Math.max(0, Number(hand!.deadline_ms) - now) : 0;
  const won = shown && Number(shown.won) > 0 && result?.outcome.kind !== "voided";

  let cards: React.ReactNode = null;
  if (bp && !bp.folded) {
    if (isMe) {
      cards = myCards ? myCards.map((c, i) => <Card key={i} card={c} fresh />) : [0, 1].map((i) => <Card key={i} down />);
    } else {
      cards = [0, 1].map((i) => <Card key={i} down />);
    }
  } else if (shown && !shown.folded && result?.outcome.kind === "showdown") {
    cards = shown.cards.map((c, i) => <Card key={i} card={c} win={!!won} />);
  } else if (shown && isMe && !shown.folded) {
    cards = shown.cards.map((c, i) => <Card key={i} card={c} />);
  }

  const tag = seat.bot
    ? `bot · ${seat.bot === "rock" ? "tight" : seat.bot === "shark" ? "aggressive" : "loose"}`
    : isMe
      ? "you"
      : seat.sitting_out
        ? "sitting out"
        : seat.leaving
          ? "leaving"
          : "player";

  const betPos = { left: `${50 + 27 * cos}%`, top: `${49 + 21 * sin}%` };
  const btnPos = { left: `${50 + 31 * Math.cos(angle + 0.32)}%`, top: `${48 + 28 * Math.sin(angle + 0.32)}%` };

  return (
    <>
      <div className="seat" style={pos}>
        <div className={`holes${isMe ? " mine" : ""}`}>{cards}</div>
        <div className={`plate${toAct || botThinking ? " turn" : ""}${bp?.folded ? " folded" : ""}${isMe ? " you" : ""}`}>
          <div className="who">{seat.name}</div>
          <div className="stack">{bp?.all_in ? "all-in" : stack.toLocaleString()}</div>
          <div className={`tag${lastMove || botThinking ? " move" : ""}`}>{botThinking ? "thinking…" : lastMove ? moveText(lastMove) : tag}</div>
          {toAct && (
            <div className={`timer${left < 8000 ? " low" : ""}`}>
              <i style={{ width: `${(left / ACTION_TIMEOUT_MS) * 100}%` }} />
            </div>
          )}
        </div>
        {(won || (shown && result?.outcome.kind === "showdown" && !shown.folded)) && (
          <div className="last-move">
            {won ? <span className="result-banner">+{(Number(shown!.won) - Number(shown!.put_in)).toLocaleString()}</span> : null} {shown?.category}
          </div>
        )}
      </div>
      {bp && bp.bet > 0 && (
        <div className="bet-chip" style={betPos}>
          {bp.bet.toLocaleString()}
        </div>
      )}
      {hand && table.button === index && <div className="button-disc" style={btnPos}>D</div>}
    </>
  );
}

function moveText(l: LogEntry) {
  const a = l.action;
  const t = a.kind === "fold" ? "fold" : a.kind === "check" ? "check" : a.kind === "call" ? `call ${Number(l.bet).toLocaleString()}` : a.kind === "raise" ? `raise to ${a.to.toLocaleString()}` : `all-in ${Number(l.bet).toLocaleString()}`;
  return l.timed_out ? `${t} (timed out)` : t;
}

function ActionBar({ hand, options, onAct, busy }: { hand: Hand; options: Options; onAct: (a: Action) => Promise<boolean>; busy: boolean }) {
  const pot = hand.betting.players.reduce((s, p) => s + p.total, 0);
  const me = hand.betting.players[hand.betting.to_act!];
  const canSize = options.can_raise && options.min_raise_to < options.max_raise_to;
  const [to, setTo] = useState(options.min_raise_to);
  const [sent, setSent] = useState(false);
  const act = async (a: Action) => {
    setSent(true);
    if (!(await onAct(a))) setSent(false);
  };
  const sized = (frac: number) => Math.min(options.max_raise_to, Math.max(options.min_raise_to, Math.round(me.bet + options.to_call + frac * (pot + options.to_call))));
  const raiseWord = hand.betting.current_bet === 0 ? "Bet" : "Raise to";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      if (sent || busy) return;
      const k = e.key.toLowerCase();
      if (k === "f" && !options.can_check) act({ kind: "fold" });
      if (k === "c") act(options.can_check ? { kind: "check" } : { kind: "call" });
      if (k === "r" && canSize) act({ kind: "raise", to });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const disabled = busy || sent;
  return (
    <div className="panel actionbar" aria-label="Your move">
      {!options.can_check && (
        <button className="btn" disabled={disabled} onClick={() => act({ kind: "fold" })}>
          Fold <kbd className="faint mono">F</kbd>
        </button>
      )}
      <button className="btn" disabled={disabled} onClick={() => act(options.can_check ? { kind: "check" } : { kind: "call" })}>
        {options.can_check ? "Check" : `Call ${Math.min(options.to_call, me.stack).toLocaleString()}`} <kbd className="faint mono">C</kbd>
      </button>
      {canSize && (
        <div className="raise">
          <input type="range" min={options.min_raise_to} max={options.max_raise_to} step={Math.max(1, Math.round(hand.betting.small_blind))} value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="Raise amount" />
          <span className="amt">{to.toLocaleString()}</span>
          <div className="presets">
            {[
              ["½", 0.5],
              ["¾", 0.75],
              ["Pot", 1],
            ].map(([l, f]) => (
              <button key={l} className="btn small ghost" onClick={() => setTo(sized(f as number))}>
                {l}
              </button>
            ))}
          </div>
          <button className="btn primary" disabled={disabled} onClick={() => act(to >= options.max_raise_to ? { kind: "all_in" } : { kind: "raise", to })}>
            {to >= options.max_raise_to ? "All-in" : `${raiseWord} ${to.toLocaleString()}`}
          </button>
        </div>
      )}
      {!canSize && options.can_raise && (
        <button className="btn primary" disabled={disabled} onClick={() => act({ kind: "all_in" })}>
          All-in {(me.stack + me.bet).toLocaleString()}
        </button>
      )}
      {sent && <span className="faint" style={{ fontSize: 13 }}>Signed and sent…</span>}
    </div>
  );
}

function BuyIn({ table, chips, onClose, onSit, busy }: { table: Table; chips: number; onClose: () => void; onSit: (n: number) => void; busy: boolean }) {
  const bb = Number(table.big_blind);
  const min = 20 * bb;
  const max = Math.min(200 * bb, chips);
  const [amount, setAmount] = useState(Math.min(100 * bb, max));
  return (
    <div className="scrim" onClick={onClose}>
      <form
        className="panel modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSit(amount);
        }}
      >
        <h3>Buy in</h3>
        {max < min ? (
          <p className="error">
            This table needs at least {min.toLocaleString()} chips and you have {chips.toLocaleString()}. Claim more in the lobby.
          </p>
        ) : (
          <>
            <label className="field">
              {amount.toLocaleString()} chips · {Math.round(amount / bb)} big blinds
              <input type="range" min={min} max={max} step={bb} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ accentColor: "var(--brass)" }} />
            </label>
            <p className="faint" style={{ margin: 0, fontSize: 13 }}>
              Your cards will be encrypted to this browser's key. If you clear site data without a backup, you can't open them.
            </p>
          </>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || max < min}>
            {busy ? "Sitting…" : "Sit down"}
          </button>
        </div>
      </form>
    </div>
  );
}

function nameAt(table: Table, hand: Hand | null, record: HandRecord | null, position: number) {
  if (hand) return table.seats[hand.betting.players[position]?.seat]?.name ?? `Seat ${position}`;
  return record?.hands.find((h) => h.position === position)?.name ?? `Seat ${position}`;
}

function Feed({ table, hand, record }: { table: Table; hand: Hand | null; record: HandRecord | null }) {
  const log = hand?.log ?? record?.log ?? [];
  if (!log.length) return <p className="faint" style={{ fontSize: 13 }}>No action yet.</p>;
  const rows: React.ReactNode[] = [];
  let street = "";
  log.forEach((l, i) => {
    if (l.street !== street) {
      street = l.street;
      rows.push(
        <li key={`s${i}`} className="street">
          {street}
        </li>,
      );
    }
    rows.push(
      <li key={i}>
        <span>{nameAt(table, hand, record, l.position)}</span>
        <span className="mono muted">{moveText(l)}</span>
      </li>,
    );
  });
  return <ul className="feed">{rows}</ul>;
}

function History({ table, hands }: { table: number; hands: HandRecord[] }) {
  if (!hands.length) return <p className="faint" style={{ fontSize: 13 }}>No finished hands yet.</p>;
  return (
    <div className="history">
      {hands.map((h) => {
        const top = [...h.hands].sort((a, b) => Number(b.won) - Number(a.won))[0];
        return (
          <Link key={h.no} to={`/t/${table}/h/${h.no}`}>
            <span>
              <span className="mono faint">#{h.no}</span> {h.outcome.kind === "voided" ? <span style={{ color: "var(--warn)" }}>voided</span> : `${top?.name} +${(Number(top?.won ?? 0) - Number(top?.put_in ?? 0)).toLocaleString()}`}
            </span>
            <span className="v">
              <MiniCards cards={h.board} /> <span className="faint">→</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
