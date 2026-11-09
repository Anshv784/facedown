import { useState } from "react";
import { Link } from "react-router-dom";
import { exportBackup, importBackup, playerId, xpubOf } from "../lib/identity";
import { chain } from "../lib/near";
import { usePlayer } from "../lib/player";

export function ProfilePage() {
  const { identity, record, adopt } = usePlayer();
  const [reveal, setReveal] = useState(false);
  const [restore, setRestore] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <main className="prose">
      <div className="eyebrow">Profile</div>
      <h1>{record ? record.name : "No player on this browser"}</h1>
      {record && (
        <dl className="kv">
          <dt>Chips</dt>
          <dd className="chips">{record.chips.toLocaleString()}</dd>
          <dt>Hands</dt>
          <dd>
            {record.hands_played} played · {record.hands_won} won
          </dd>
          <dt>Net</dt>
          <dd className="mono">{record.net >= 0 ? "+" : ""}{record.net.toLocaleString()}</dd>
          <dt>Player key</dt>
          <dd className="mono">{identity && playerId(identity)}</dd>
          <dt>Card key</dt>
          <dd className="mono">{identity && xpubOf(identity)}</dd>
        </dl>
      )}

      {identity && (
        <>
          <h2>Back up your keys</h2>
          <p>
            Your player is two private keys stored in this browser. Anyone with this backup can play as you and open your
            cards, so keep it somewhere private. Use it to move your player to another device.
          </p>
          {reveal ? (
            <div className="panel" style={{ padding: 14 }}>
              <code className="mono" style={{ wordBreak: "break-all", border: 0, background: "none" }}>{exportBackup(identity)}</code>
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button className="btn small" onClick={() => navigator.clipboard?.writeText(exportBackup(identity)).then(() => setMsg("Copied."))}>
                  Copy
                </button>
                <button className="btn small ghost" onClick={() => setReveal(false)}>
                  Hide
                </button>
              </div>
            </div>
          ) : (
            <button className="btn" onClick={() => setReveal(true)}>
              Show backup
            </button>
          )}
        </>
      )}

      <h2>Restore a player</h2>
      <p>Paste a backup from another device. This replaces the player on this browser{identity ? ", so back it up first" : ""}.</p>
      <form
        style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
        onSubmit={async (e) => {
          e.preventDefault();
          const next = importBackup(restore);
          if (!next) return setMsg("That isn't a Facedown backup.");
          const rec = await chain.player(playerId(next)).catch(() => null);
          if (!rec) return setMsg("No player with that key exists on this table contract.");
          adopt(next);
          setRestore("");
          setMsg(`Restored ${rec.name}.`);
        }}
      >
        <input className="input" style={{ flex: 1, minWidth: 240 }} placeholder="facedown1:…" value={restore} onChange={(e) => setRestore(e.target.value)} aria-label="Backup" />
        <button className="btn primary" disabled={!restore.trim()}>
          Restore
        </button>
      </form>
      {msg && <p className="muted">{msg}</p>}
      <p style={{ marginTop: 40 }}>
        <Link to="/play">← Back to the tables</Link>
      </p>
    </main>
  );
}
