import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/index.css";
import App from "./App.jsx";
import { bootstrapThemeFromStorage } from "./lib/theme.js";
import { bootstrapAccentFromStorage } from "./lib/accent.js";
import { captureDeepLinkIntentFromUrl } from "./lib/deepLinks.js";
import { initErrorTracking } from "./lib/errorTracking.js";
import { initAnalytics } from "./lib/analytics.js";
import { fetchPublicConfig } from "./lib/publicConfig.js";
import { bootstrapLanguage, loadLanguage } from "./i18n/index.jsx";

// Apply the user's last-known theme + accent before React mounts so
// the first paint never flashes the wrong palette. The authoritative
// values arrive a bit later from the server-side settings.
bootstrapThemeFromStorage();
bootstrapAccentFromStorage();

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

// 計 · Umami init — synchronous, reads `window.__APP_CONFIG__.umami`
// populated by the inline `<script>` block in index.html (templated by
// the nginx entrypoint). No fetch, no blind spot — pageviews start
// being tracked from the very first navigation.
initAnalytics();

// 監 · Sentry / Bugsink — non-blocking. `fetchPublicConfig()` runs in
// parallel with the React mount; when it resolves, the SDK init runs
// against whatever errors are already in flight. Trade-off: the ~5–50 ms
// between mount and SDK init aren't covered by Sentry on a brand-new
// install (no SW cache yet), but the perceived boot is unchanged from
// "no observability at all" — and per the spec, a silent fetch failure
// just leaves the feature disabled for this session.
fetchPublicConfig().then((config) => {
  if (config?.errorTracking) initErrorTracking(config.errorTracking);
});

// 言 · Pre-load the active language bundle (and English fallback if
// different) BEFORE the React tree mounts. Each language is its own
// code-split chunk, so visitors only download what they need — English
// users skip ~100 KB of FR/ES translations, etc. The await is bounded
// by the network round-trip on first visit; after that, the SW
// precache + browser cache make it instant. While this resolves, the
// inline boot script in index.html is already painting the right
// theme/accent so the user sees a styled splash immediately.
loadLanguage(bootstrapLanguage()).then(() => {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
});
