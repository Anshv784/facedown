import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { chain } from "../lib/near";
import { usePlayer, usePoll } from "../lib/player";
import type { BotStyle, HandRecord, TableSummary } from "../lib/types";
import { MiniCards } from "../ui/Card";
import { Stage, useNowTick } from "./Table";

const CLAIM_EVERY_MS = 4 * 60 * 60 * 1000;

export function Lobby() {
  const { data: tables, error } = usePoll(() => chain.tables(), 3000, []);
  return (
    <main className="home">
      <div className="home-main">
        <div className="panel strip">
          <div>
            <h1>No-limit Hold'em with a dealer nobody can see into</h1>
            <p>
              Decks come from verifiable randomness, cards are encrypted to your browser, and the contract audits every hand before a chip moves.
            </p>
          </div>
          <Link to="/how" className="btn small">How it's fair</Link>
        </div>
        <Featured tables={tables} />
        <section>
          <div className="section-head">
            <h2>Tables</h2>
            <OpenTable />
          </div>
          {error && !tables && <p className="error">Couldn't reach NEAR testnet: {error}</p>}
          <div className="panel tables-wrap">
            <div className="trow thead">
              <span>Table</span>
              <span className="hide-sm">Blinds</span>
              <span className="hide-sm">Seats</span>
              <span className="hide-sm">Status</span>
              <span />
            </div>
            {!tables && !error && <div className="trow faint">Loading tables…</div>}
            {tables?.map((t) => (
              <Link key={t.id} to={`/t/${t.id}`} className="trow">
                <div>
                  <div className="name">{t.name}</div>
                  <div className="faint" style={{ fontSize: 13 }}>
                    {t.players} player{t.players === 1 ? "" : "s"} · {t.bots} bot{t.bots === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="stakes hide-sm">
                  {Number(t.small_blind).toLocaleString()}/{Number(t.big_blind).toLocaleString()}
                </div>
                <div className="dots hide-sm" aria-label={`${t.players} players, ${t.bots} bots, ${t.max_seats} seats`}>
                  {Array.from({ length: t.max_seats }, (_, i) => (
                    <span key={i} className={`dot ${i < t.players ? "p" : i < t.players + t.bots ? "b" : ""}`} />
                  ))}
                </div>
                <div className={`live hide-sm ${t.hand_running ? "on" : ""}`}>
                  {t.hand_running ? "Hand in play" : "Waiting"} · {Number(t.hands_dealt)} dealt
                </div>
                <span className="btn small">Join</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
      <aside className="home-side">
        <Me />
        <Leaders />
        <Audited tables={tables} />
      </aside>
    </main>
  );
}

/** The busiest table, rendered live from chain state. */
function Featured({ tables }: { tables: TableSummary[] | null }) {
  const pick = useMemo(() => {
    if (!tables?.length) return null;
    return [...tables].sort((a, b) => Number(b.hand_running) - Number(a.hand_running) || b.players - a.players || Number(b.hands_dealt) - Number(a.hands_dealt))[0];
  }, [tables]);
  const id = pick?.id ?? -1;
  const { data: table } = usePoll(() => (id >= 0 ? chain.table(id) : Promise.resolve(null)), 2000, [id]);
  const { data: recent } = usePoll(() => (id >= 0 ? chain.recent(id, 1) : Promise.resolve([])), 6000, [id, table?.last_hand]);
  const now = useNowTick();
  if (!pick || !table) return <div className="panel" style={{ height: 420 }} />;
  const last = recent?.[0] ?? null;
  const result = !table.hand && last && last.no === table.last_hand ? last : null;
  return (
    <Link to={`/t/${table.id}`} className="panel featured" aria-label={`Open ${table.name}`}>
      <div className="featured-head">
        <div>
          <b>{table.name}</b>{" "}
          <span className="faint num" style={{ marginLeft: 6 }}>
            {Number(table.small_blind)}/{Number(table.big_blind)}
          </span>
        </div>
        <span className={`live-dot ${table.hand ? "on" : ""}`}>{table.hand ? `Live · hand #${table.hand.no}` : "Between hands"}</span>
      </div>
      <Stage table={table} hand={table.hand} result={result} me={null} myCards={null} now={now} origin={0} canSit={false} onSit={() => {}} />
    </Link>
  );
}

function Leaders() {
  const { data } = usePoll(() => chain.leaderboard(), 15000, []);
  return (
    <section className="panel side-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Leaderboard</h3>
        <Link to="/leaderboard" className="faint" style={{ fontSize: 13 }}>All →</Link>
      </div>
      {!data?.length && <span className="faint" style={{ fontSize: 14 }}>No finished hands with players yet.</span>}
      {data?.slice(0, 5).map((e, i) => (
        <div key={e.player} className="lb-row">
          <span className="rk">{i + 1}</span>
          <span>{e.name}</span>
          <span className={`num ${Number(e.net.toString()) >= 0 ? "ok" : "error"}`}>
            {Number(e.net) >= 0 ? "+" : ""}
            {Number(e.net).toLocaleString()}
          </span>
        </div>
      ))}
    </section>
  );
}

/** Newest finished hands across all tables, each with its audit result. */
function Audited({ tables }: { tables: TableSummary[] | null }) {
  const key = tables?.map((t) => `${t.id}:${t.hands_dealt}`).join(",") ?? "";
  const { data } = usePoll(
    async () => {
      if (!tables) return [];
      const lists = await Promise.all(tables.map((t) => chain.recent(t.id, 4).catch(() => [] as HandRecord[])));
      return lists.flat().sort((a, b) => Number(b.ended_ms) - Number(a.ended_ms)).slice(0, 7);
    },
    10000,
    [key],
  );
  const name = (t: number) => tables?.find((x) => x.id === t)?.name ?? `Table ${t}`;
  return (
    <section className="panel side-card">
      <h3>Recently audited</h3>
      <div className="audit-feed">
        {!data?.length && <span className="faint" style={{ fontSize: 14 }}>Nothing yet.</span>}
        {data?.map((h) => {
          const top = [...h.hands].sort((a, b) => Number(b.won) - Number(a.won))[0];
          const voided = h.outcome.kind === "voided";
          return (
            <Link key={`${h.table}-${h.no}`} to={`/t/${h.table}/h/${h.no}`}>
              <span className={`seal ${voided ? "bad" : ""}`}>{voided ? "VOID" : "✓"}</span>
              <span>
                {name(h.table)} <span className="faint">#{h.no}</span>
                <br />
                <span className="faint" style={{ fontSize: 12.5 }}>{voided ? "refunded" : `${top?.name} won ${Number(top?.won ?? 0).toLocaleString()}`}</span>
              </span>
              <MiniCards cards={h.board} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Me() {
  const { record, loading, register, busy, run } = usePlayer();
  const [name, setName] = useState("");
  if (loading) return <section className="panel side-card" style={{ height: 150 }} />;
  if (!record) {
    return (
      <section className="panel side-card">
        <h3>Get a seat</h3>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Pick a name and get 5,000 play chips. No wallet: this browser makes two keys, one signs your moves, the other opens your cards.
        </p>
        <form
          style={{ display: "grid", gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) register(name);
          }}
        >
          <input className="input" placeholder="Name at the table" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name at the table" />
          <button className="btn primary" disabled={busy || name.trim().length < 2}>
            {busy ? "Creating…" : "Join Facedown"}
          </button>
        </form>
      </section>
    );
  }
  const nextClaim = record.last_claim_ms + CLAIM_EVERY_MS;
  const canClaim = Date.now() >= nextClaim;
  return (
    <section className="panel side-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3>{record.name}</h3>
        <Link to="/me" className="faint" style={{ fontSize: 13 }}>Profile →</Link>
      </div>
      <div className="chips" style={{ fontSize: 30, lineHeight: 1 }}>{record.chips.toLocaleString()}</div>
      <div>
        <div className="kv-row"><span className="muted">Hands</span><span className="num">{record.hands_played}</span></div>
        <div className="kv-row"><span className="muted">Won</span><span className="num">{record.hands_won}</span></div>
        <div className="kv-row"><span className="muted">Net</span><span className="num">{record.net >= 0 ? "+" : ""}{record.net.toLocaleString()}</span></div>
      </div>
      <button className="btn small" disabled={!canClaim || busy} onClick={() => run({ do: "claim" })}>
        {canClaim ? "Claim 2,000 chips" : `More chips in ${Math.ceil((nextClaim - Date.now()) / 60000)} min`}
      </button>
    </section>
  );
}

function OpenTable() {
  const { record, run, busy } = usePlayer();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [blind, setBlind] = useState(25);
  const [seats, setSeats] = useState(4);
  const [bots, setBots] = useState<BotStyle[]>(["shark"]);
  if (!record) return null;
  const toggle = (b: BotStyle) =>
    setBots((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : cur.length < seats - 1 ? [...cur, b] : cur));
  return (
    <>
      <button className="btn small" onClick={() => setOpen(true)}>
        Open a table
      </button>
      {open && (
        <div className="scrim" onClick={() => setOpen(false)}>
          <form
            className="panel modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              const before = await chain.stats().catch(() => null);
              const ok = await run({
                do: "open_table",
                name: name.trim() || `${record.name}'s table`,
                small_blind: String(blind),
                max_seats: seats,
                bots,
              });
              if (ok) {
                setOpen(false);
                nav(before ? `/t/${before.tables}` : "/");
              }
            }}
          >
            <h3>Open a table</h3>
            <label className="field">
              Name
              <input className="input" maxLength={32} value={name} placeholder={`${record.name}'s table`} onChange={(e) => setName(e.target.value)} />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label className="field">
                Small blind
                <select className="input" value={blind} onChange={(e) => setBlind(Number(e.target.value))}>
                  {[5, 10, 25, 50, 100].map((b) => (
                    <option key={b} value={b}>
                      {b}/{b * 2}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Seats
                <select className="input" value={seats} onChange={(e) => { const n = Number(e.target.value); setSeats(n); setBots((b) => b.slice(0, n - 1)); }}>
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="field">
              House bots (they see only their own cards)
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(
                  [
                    ["rock", "Rook · tight"],
                    ["shark", "Vega · aggressive"],
                    ["fish", "Pip · loose"],
                  ] as [BotStyle, string][]
                ).map(([b, label]) => (
                  <button type="button" key={b} className={`btn small ${bots.includes(b) ? "primary" : ""}`} onClick={() => toggle(b)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy}>
                {busy ? "Opening…" : "Open table"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
