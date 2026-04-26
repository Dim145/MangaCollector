import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/index.css";
import App from "./App.jsx";
import { bootstrapThemeFromStorage } from "./lib/theme.js";
import { captureDeepLinkIntentFromUrl } from "./lib/deepLinks.js";

// Apply the user's last-known theme before React mounts so the first paint
// never flashes the wrong palette. The authoritative value arrives a bit
// later from the server-side settings.
bootstrapThemeFromStorage();

// 共有 · Capture deep-link query params (PWA shortcut, Web Share Target)
// to sessionStorage and strip them from the URL BEFORE React mounts.
// Two reasons this has to run pre-mount:
//   1. If the user is unauthenticated, ProtectedRoute redirects to
//      /log-in on the next React tick — without the pre-mount capture
//      the share / shortcut intent would be lost forever.
//   2. The IdP redirect (when the user signs in afterwards) inherits
//      Referer from the current URL. Stripping the params first means
//      shared text — untrusted user input from another app — never
//      reaches the IdP as referer data.
captureDeepLinkIntentFromUrl();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
