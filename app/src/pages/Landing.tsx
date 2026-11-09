import { useMemo } from "react";
import { Link } from "react-router-dom";
import { chain } from "../lib/near";
import { usePoll } from "../lib/player";
import type { HandRecord, TableSummary } from "../lib/types";
import { MiniCards } from "../ui/Card";
import { Mark } from "../ui/Logo";
import { Stage, useNowTick } from "./Table";

const short = (h?: string | null, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");

export function Landing() {
  const { data: tables } = usePoll(() => chain.tables(), 5000, []);
  const { data: stats } = usePoll(() => chain.stats(), 10000, []);
  const key = tables?.map((t) => `${t.id}:${t.hands_dealt}`).join(",") ?? "";
  const { data: recent } = usePoll(
    async () => {
      if (!tables) return [];
      const lists = await Promise.all(tables.map((t) => chain.recent(t.id, 3).catch(() => [] as HandRecord[])));
      return lists.flat().sort((a, b) => Number(b.ended_ms) - Number(a.ended_ms));
    },
    15000,
    [key],
  );
  const latest = recent?.find((h) => h.outcome.kind !== "voided" && h.salt) ?? null;
  const tableName = (id: number) => tables?.find((t) => t.id === id)?.name ?? `Table ${id}`;

  return (
    <main className="landing">
      <section className="l-hero">
        <div className="l-hero-copy">
          <span className="l-tag">
            <span className="l-live" /> Live on NEAR testnet · play chips
          </span>
          <h1>Poker where the dealer can't see your cards.</h1>
          <p>
            Facedown deals every hand inside a sealed enclave, from randomness nobody can choose. Your two cards are encrypted to a key that never leaves your browser, and
            the contract audits the whole deck before a single chip moves.
          </p>
          <div className="l-cta">
            <Link to="/play" className="btn primary l-big">
              Play now, free
            </Link>
            {latest ? (
              <Link to={`/t/${latest.table}/h/${latest.no}`} className="btn l-big">
                Audit a real hand
              </Link>
            ) : (
              <Link to="/how" className="btn l-big">
                How it's fair
              </Link>
            )}
          </div>
          <div className="l-proof">
            <span>
              <b className="num">{stats ? Number(stats.hands_played).toLocaleString() : "…"}</b> hands dealt and audited
            </span>
            <span>
              <b className="num">0</b> wallets needed
            </span>
            <span>
              <b className="num">0</b> people who can see your cards
            </span>
          </div>
        </div>
        <HeroTable tables={tables} />
      </section>

      <section className="l-band">
        <div className="l-split">
          <div>
            <div className="eyebrow">Why this exists</div>
            <h2>On TV poker, a camera under the table shows the audience every card. Online poker has one too. It's the server.</h2>
            <p>
              In 2007, players at Absolute Poker noticed an account that won far too often. It played as if it could see everyone's hole cards, because it could: an insider
              was using a hidden "superuser" account. At UltimateBet the same trick ran for years, and millions were taken before anyone proved it.
            </p>
            <p>
              Every online card room still has that shape. One machine shuffles, deals and sees everything, and you're asked to trust that nobody is looking.{" "}
              <b>Facedown is a card room with no camera.</b>
            </p>
          </div>
          <div className="l-file panel">
            <div className="l-file-head">
              <span className="eyebrow">Case file</span>
              <span className="mono faint">2004 – 2008</span>
            </div>
            <dl>
              <dt>Where</dt>
              <dd>Absolute Poker, UltimateBet</dd>
              <dt>How</dt>
              <dd>Insider "superuser" accounts that could see every opponent's hole cards</dd>
              <dt>Caught by</dt>
              <dd>Players analysing impossible win rates in hand histories</dd>
              <dt>Root cause</dt>
              <dd>The dealer was a server, and someone could look inside it</dd>
            </dl>
          </div>
        </div>
      </section>

      <section className="l-section">
        <div className="l-head">
          <div className="eyebrow">Who sees what</div>
          <h2>While a hand is live, every seat sees exactly what it should, and nothing more</h2>
        </div>
        <div className="l-seegrid">
          {[
            ["You", "Your two cards, decrypted in your browser, and the board", true],
            ["Other players", "Their own two cards. Yours stay face down", true],
            ["House bots", "Only their own two cards. They play inside the enclave but are never handed the deck", true],
            ["The contract", "Ciphertexts, a hash of the dealer's secret, a randomness proof", false],
            ["Us, the operator", "The same as the contract. No admin view, no back door", false],
            ["The dealer", "The deck, inside an Intel TDX enclave running public, hash-pinned code", true],
          ].map(([who, what, sees]) => (
            <div key={who as string} className="l-see panel">
              <span className={`l-eye ${sees ? "" : "off"}`} aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  {sees ? (
                    <>
                      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  ) : (
                    <>
                      <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
                    </>
                  )}
                </svg>
              </span>
              <div>
                <b>{who}</b>
                <p>{what}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="l-note">When the hand ends the whole deck becomes public, and the contract checks it before anyone is paid. A mismatch voids the hand and refunds every chip.</p>
      </section>

      <section className="l-section">
        <div className="l-head">
          <div className="eyebrow">Anatomy of a hand</div>
          <h2>{latest ? `${tableName(latest.table)}, hand #${latest.no}: its real receipts, read from NEAR just now` : "Every hand leaves receipts on chain"}</h2>
        </div>
        <ol className="l-steps">
          <li className="panel">
            <span className="l-n">1</span>
            <b>Randomness nobody chose</b>
            <p>OutLayer's VRF signs this exact hand's seed. The contract checks the proof before it accepts the deal.</p>
            <code>{short(latest?.vrf?.output)}</code>
          </li>
          <li className="panel">
            <span className="l-n">2</span>
            <b>A secret, locked in first</b>
            <p>The dealer commits to a salt from a key generated inside the enclave. The deck is fixed from here.</p>
            <code>{short(latest?.salt_commit)}</code>
          </li>
          <li className="panel">
            <span className="l-n">3</span>
            <b>Sealed to each player</b>
            <p>Hole cards are encrypted to each player's own key with X25519 and ChaCha20-Poly1305. Streets are revealed one at a time.</p>
            <code>{latest ? <MiniCards cards={latest.board} /> : "—"}</code>
          </li>
          <li className="panel">
            <span className="l-n">4</span>
            <b>Revealed, rebuilt, checked</b>
            <p>The salt is revealed, the contract rebuilds all 52 cards and checks every one, then pays.</p>
            <code>{short(latest?.salt)}</code>
          </li>
        </ol>
        {latest && (
          <div style={{ marginTop: 16 }}>
            <Link to={`/t/${latest.table}/h/${latest.no}`} className="btn">
              Re-run this audit in your browser →
            </Link>
          </div>
        )}
      </section>

      <section className="l-section">
        <div className="l-head">
          <div className="eyebrow">The house</div>
          <h2>Bots that keep every table busy, and play as blind as you do</h2>
        </div>
        <div className="l-bots">
          {[
            ["Rook", "Tight", "Waits for real hands and bets them hard. Rarely bluffs."],
            ["Vega", "Aggressive", "Raises often and semi-bluffs when nobody has shown strength."],
            ["Pip", "Loose", "Calls too much and peels cheap bets. The table's friendly donor."],
          ].map(([name, style, desc]) => (
            <div key={name} className="l-bot panel">
              <div className="l-bot-top">
                <b>{name}</b>
                <span className="l-chip">{style}</span>
              </div>
              <p>{desc}</p>
              <span className="faint" style={{ fontSize: 13 }}>Estimates its odds by dealing out the cards it can't see, hundreds of times, inside the enclave.</span>
            </div>
          ))}
        </div>
      </section>

      <section className="l-final">
        <Mark size={52} />
        <h2>The dealer can't see your cards. Neither can we.</h2>
        <div className="l-cta" style={{ justifyContent: "center" }}>
          <Link to="/play" className="btn primary l-big">
            Take a seat
          </Link>
          <Link to="/how" className="btn l-big">
            Read how it works
          </Link>
        </div>
        {recent && recent.length > 0 && (
          <p className="faint" style={{ fontSize: 13.5, marginTop: 18 }}>
            Latest: {tableName(recent[0].table)} #{recent[0].no} · {recent[0].outcome.kind === "voided" ? "voided and refunded" : "audited ✓"}
          </p>
        )}
      </section>
    </main>
  );
}

/** The busiest table, live, with the three facts pinned to it. */
function HeroTable({ tables }: { tables: TableSummary[] | null }) {
  const pick = useMemo(() => {
    if (!tables?.length) return null;
    return [...tables].sort((a, b) => Number(b.hand_running) - Number(a.hand_running) || b.players + b.bots - (a.players + a.bots))[0];
  }, [tables]);
  const id = pick?.id ?? -1;
  const { data: table } = usePoll(() => (id >= 0 ? chain.table(id) : Promise.resolve(null)), 2000, [id]);
  const now = useNowTick();
  return (
    <div className="l-hero-table">
      <div className="l-device panel">
        <div className="l-device-bar">
          <span className="l-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="mono faint">{table ? `${table.name} · ${table.hand ? `hand #${table.hand.no} live` : "between hands"}` : "connecting…"}</span>
        </div>
        {table ? (
          <Link to={`/t/${table.id}`} aria-label={`Watch ${table.name}`}>
            <Stage table={table} hand={table.hand} result={null} me={null} myCards={null} now={now} origin={0} canSit={false} onSit={() => {}} />
          </Link>
        ) : (
          <div style={{ aspectRatio: "1.72" }} />
        )}
      </div>
      <div className="l-pin" style={{ left: "-4%", top: "18%" }}>
        <b>Face down to everyone</b>
        <span>Sealed to each player's own key</span>
      </div>
      <div className="l-pin" style={{ right: "-3%", top: "46%" }}>
        <b>Dealt in an enclave</b>
        <span>OutLayer TEE · VRF randomness</span>
      </div>
      <div className="l-pin" style={{ left: "8%", bottom: "-5%" }}>
        <b>Audited before payout</b>
        <span>The contract rebuilds the deck</span>
      </div>
    </div>
  );
}
