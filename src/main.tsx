import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { notifyFrontendReady } from "./lib/tauri";
import "./styles/global.css";
import "./styles/electron.css";

// The window starts hidden (see src-tauri). Reveal it only once the app
// has painted its first frame, so the first thing the user sees is the
// themed UI — never the webview's white default. Two rAFs guarantee a
// paint has happened; the timeout is a fallback in case rAF is throttled
// while the window is still hidden.
(() => {
  let signalled = false;
  const reveal = () => {
    if (signalled) return;
    signalled = true;
    void notifyFrontendReady();
  };
  requestAnimationFrame(() => requestAnimationFrame(reveal));
  setTimeout(reveal, 150);
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
