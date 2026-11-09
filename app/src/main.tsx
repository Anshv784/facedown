import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/archivo/standard.css";
import "@fontsource-variable/martian-mono/standard.css";
import "./styles.css";
import { App } from "./App";
import { PlayerProvider } from "./lib/player";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </BrowserRouter>
  </StrictMode>,
);
