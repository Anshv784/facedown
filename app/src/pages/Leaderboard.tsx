import { chain } from "../lib/near";
import { usePlayer, usePoll } from "../lib/player";

export function LeaderboardPage() {
  const { data, error } = usePoll(() => chain.leaderboard(), 10000, []);
  const { id } = usePlayer();
  return (
    <main className="page">
      <h1>Leaderboard</h1>
      <p>Net chips won at the tables, from the contract's own records. Every hand behind these numbers was audited before it paid.</p>
      {error && <p className="error">{error}</p>}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="trow thead" style={{ gridTemplateColumns: "40px 1fr 90px 90px 110px" }}>
          <span>#</span>
          <span>Player</span>
          <span>Hands</span>
          <span>Won</span>
          <span style={{ textAlign: "right" }}>Net</span>
        </div>
        {!data?.length && <div className="trow faint">No finished hands with players yet.</div>}
        {data?.map((e, i) => (
          <div key={e.player} className="trow" style={{ gridTemplateColumns: "40px 1fr 90px 90px 110px", background: e.player === id ? "var(--panel-2)" : undefined }}>
            <span className="num faint">{i + 1}</span>
            <span style={{ fontWeight: 600 }}>
              {e.name} {e.player === id && <span className="faint">(you)</span>}
            </span>
            <span className="num">{Number(e.hands)}</span>
            <span className="num">{Number(e.won)}</span>
            <span className="num" style={{ textAlign: "right", color: Number(e.net) >= 0 ? "var(--good)" : "var(--bad)" }}>
              {Number(e.net) >= 0 ? "+" : ""}
              {Number(e.net).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
