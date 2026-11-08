import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { CONTRACT, EXPLORER } from "./lib/config";
import { usePlayer } from "./lib/player";
import { Mark } from "./ui/Logo";
import { Lobby } from "./pages/Lobby";
import { TablePage } from "./pages/Table";
import { HandPage } from "./pages/Hand";
import { HowPage } from "./pages/How";
import { ProfilePage } from "./pages/Profile";

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
            <NavLink to="/" end>
              Tables
            </NavLink>
            <NavLink to="/how" className="hide-sm">
              How it's fair
            </NavLink>
            {record ? (
              <NavLink to="/me">
                {record.name} · <span className="chips">{record.chips.toLocaleString()}</span>
              </NavLink>
            ) : null}
            <span className="net">testnet</span>
          </nav>
        </header>
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/t/:table" element={<TablePage />} />
          <Route path="/t/:table/h/:hand" element={<HandPage />} />
          <Route path="/how" element={<HowPage />} />
          <Route path="/me" element={<ProfilePage />} />
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
