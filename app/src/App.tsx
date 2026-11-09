import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { CONTRACT, EXPLORER } from "./lib/config";
import { usePlayer } from "./lib/player";
import { Mark } from "./ui/Logo";
import { Lobby } from "./pages/Lobby";
import { Landing } from "./pages/Landing";
import { TablePage } from "./pages/Table";
import { HandPage } from "./pages/Hand";
import { HowPage } from "./pages/How";
import { ProfilePage } from "./pages/Profile";
import { LeaderboardPage } from "./pages/Leaderboard";
import { isMuted, setMuted } from "./lib/sound";

export function App() {
  const { record, error, clearError } = usePlayer();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 6000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <Link to="/" className="brand" aria-label="Facedown home">
            <Mark size={30} />
            <span className="word">Facedown</span>
          </Link>
          <nav className="nav">
            <NavLink to="/play">
              Play
            </NavLink>
            <NavLink to="/leaderboard" className="hide-sm">
              Leaderboard
            </NavLink>
            <NavLink to="/how" className="hide-sm">
              How it's fair
            </NavLink>
            <SoundToggle />
            {record ? (
              <NavLink to="/me">
                {record.name} <span className="chipcount num" style={{ marginLeft: 6 }}>{record.chips.toLocaleString()}</span>
              </NavLink>
            ) : null}
            <span className="net">testnet</span>
            {!record && pathname === "/" && (
              <Link to="/play" className="btn primary small" style={{ marginLeft: 8 }}>
                Play now
              </Link>
            )}
          </nav>
        </header>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/play" element={<Lobby />} />
          <Route path="/t/:table" element={<TablePage />} />
          <Route path="/t/:table/h/:hand" element={<HandPage />} />
          <Route path="/how" element={<HowPage />} />
          <Route path="/me" element={<ProfilePage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="*" element={<div className="prose"><h1>Nothing here.</h1><Link to="/">Back to the tables</Link></div>} />
        </Routes>
        <footer className="foot">
          <span>
            Facedown · cards dealt inside an OutLayer TEE, audited by{" "}
            <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer" className="mono">
              {CONTRACT}
            </a>
          </span>
          <span>
            <a href="https://github.com/Anshv784/facedown" target="_blank" rel="noreferrer">Source</a> · Play chips only, no real money
          </span>
        </footer>
      </div>
      {error && (
        <div className="toast" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
    </>
  );
}

function SoundToggle() {
  const [muted, set] = useState(isMuted());
  return (
    <button
      className="btn ghost small"
      aria-label={muted ? "Turn sounds on" : "Mute sounds"}
      title={muted ? "Sounds off" : "Sounds on"}
      onClick={() => {
        setMuted(!muted);
        set(!muted);
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" />
        {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
      </svg>
    </button>
  );
}
