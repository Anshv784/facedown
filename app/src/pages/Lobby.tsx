import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { chain } from "../lib/near";
import { usePlayer, usePoll } from "../lib/player";
import type { BotStyle } from "../lib/types";
import { Card } from "../ui/Card";

const CLAIM_EVERY_MS = 4 * 60 * 60 * 1000;

export function Lobby() {
  const { data: tables, error } = usePoll(() => chain.tables(), 3000, []);
  const { data: stats } = usePoll(() => chain.stats(), 8000, []);

  return (
    <main>
      <section className="hero">
        <div>
          <div className="eyebrow">No-limit Hold'em on NEAR</div>
          <h1>
            The dealer can't see your cards. <em>Neither can we.</em>
          </h1>
          <p className="lede">
            Every deck is shuffled inside a sealed enclave from randomness no one can choose, your two cards are encrypted
            to a key that never leaves this browser, and when the hand ends the contract re-checks every card that was
            dealt.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href="#tables" className="btn primary">
              Take a seat
            </a>
            <Link to="/how" className="btn ghost">
              How the deal stays honest
            </Link>
          </div>
          {stats && (
            <p className="faint mono" style={{ marginTop: 22 }}>
              {Number(stats.hands_played).toLocaleString()} hands dealt and audited on chain · {stats.tables} tables
            </p>
          )}
        </div>
        <HeroCards />
      </section>

      <Me />

      <section id="tables" style={{ scrollMarginTop: 24, marginTop: 40 }}>
        <div className="section-head">
          <h2>Tables</h2>
          <OpenTable />
        </div>
        {error && !tables && <p className="error">Couldn't reach NEAR testnet: {error}</p>}
        <div className="tables">
          {!tables && !error && <div className="panel trow faint">Loading tables…</div>}
          {tables?.length === 0 && <div className="panel trow faint">No tables yet.</div>}
          {tables?.map((t) => (
            <Link key={t.id} to={`/t/${t.id}`} className="panel trow">
              <div>
                <div className="name">{t.name}</div>
                <div className="faint" style={{ fontSize: 13 }}>
                  Table {t.id}
                </div>
              </div>
              <div className="mono hide-sm">
                {Number(t.small_blind).toLocaleString()}/{Number(t.big_blind).toLocaleString()}
              </div>
              <div className="dots hide-sm" aria-label={`${t.players} players, ${t.bots} bots, ${t.max_seats} seats`}>
                {Array.from({ length: t.max_seats }, (_, i) => (
                  <span key={i} className={`dot ${i < t.players ? "p" : i < t.players + t.bots ? "b" : ""}`} />
                ))}
              </div>
              <div className={`live hide-sm ${t.hand_running ? "on" : ""}`}>
                {t.hand_running ? "Hand in play" : "Waiting"} · {Number(t.hands_dealt)}
              </div>
              <span className="btn small">Open</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="steps">
        <div className="step">
          <div className="n">01 · Randomness</div>
          <h3>A deck nobody chose</h3>
          <p>
            Each hand starts from OutLayer's verifiable random output. Its proof is checked inside the contract, so the
            house can't re-roll a deck it doesn't like.
          </p>
        </div>
        <div className="step">
          <div className="n">02 · Sealing</div>
          <h3>Cards only you can open</h3>
          <p>
            The shuffle runs inside a TDX enclave. Your hole cards leave it encrypted to your key; bots are shown only
            their own two cards, exactly like you.
          </p>
        </div>
        <div className="step">
          <div className="n">03 · Audit</div>
          <h3>Checked before anyone is paid</h3>
          <p>
            The dealer locks a secret before the deal and reveals it after. The contract rebuilds the deck and refunds
            everyone if a single card doesn't match.
          </p>
        </div>
      </section>
    </main>
  );
}

function HeroCards() {
  return (
    <div className="hero-cards" aria-hidden="true">
      <Card card={51} style={{ left: "8%", top: 30, transform: "rotate(-9deg)" }} />
      <Card down style={{ left: "38%", top: 10, transform: "rotate(6deg)" }} />
      <div className="hero-stamp" style={{ right: 0, bottom: 34 }}>
        sealed to <b>your x25519 key</b>
        <br />
        chacha20-poly1305 · opens only here
      </div>
      <div className="hero-stamp" style={{ left: 0, bottom: 0 }}>
        vrf ✓ · salt commit ✓ · board ✓
      </div>
    </div>
  );
}

function Me() {
  const { record, loading, register, busy, run } = usePlayer();
  const [name, setName] = useState("");
  if (loading) return null;
  if (!record) {
    return (
      <section className="panel" style={{ padding: 22, display: "grid", gap: 14 }}>
        <div>
          <div className="eyebrow">Your seat</div>
          <h2 className="serif" style={{ fontSize: 30, margin: "6px 0 4px", fontWeight: 400 }}>
            Pick a name and get 5,000 chips
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            No wallet needed. This browser makes two keys: one signs your moves, the other opens your cards. Play chips
            only.
          </p>
        </div>
        <form
          style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) register(name);
          }}
        >
          <input
            className="input"
            style={{ maxWidth: 320 }}
            placeholder="Name at the table"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name at the table"
          />
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
    <section className="panel me">
      <div style={{ flex: 1 }}>
        <div className="eyebrow">Signed in on this browser</div>
        <div style={{ fontSize: 18, fontWeight: 500 }}>
          {record.name} · <span className="chips">{record.chips.toLocaleString()} chips</span>
        </div>
        <div className="faint" style={{ fontSize: 13 }}>
          {record.hands_played} hands · {record.hands_won} won · net{" "}
          <span className="mono">{record.net >= 0 ? "+" : ""}{record.net.toLocaleString()}</span>
        </div>
      </div>
      <button className="btn small" disabled={!canClaim || busy} onClick={() => run({ do: "claim" })}>
        {canClaim ? "Claim 2,000 chips" : `More chips in ${Math.ceil((nextClaim - Date.now()) / 60000)} min`}
      </button>
      <Link to="/me" className="btn small ghost">
        Profile & backup
      </Link>
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
