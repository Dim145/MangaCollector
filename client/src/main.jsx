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
import { rememberCoverProxySetting } from "./lib/covers.js";
import { bootstrapLanguage, loadLanguage } from "./i18n/index.jsx";
import { preloadPageFor } from "./routePages.js";
import { noteBootShell } from "./lib/bootShell.js";
import { getCachedUser } from "./utils/auth.js";

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
  // 影 · Whether the operator relays covers through the server. Noted
  // here; `lib/covers.js` only acts on it once there is a session,
  // because the relay is authenticated.
  rememberCoverProxySetting(config?.proxyCovers);
  // `initErrorTracking` now loads the SDK chunk on demand; a failed
  // load (first visit while offline, chunk not yet in the SW cache)
  // must not surface as an unhandled rejection — the app simply runs
  // without error tracking until the next boot.
  if (config?.errorTracking) {
    initErrorTracking(config.errorTracking).catch(() => {});
  }
  // 測 · Field measurements, when the operator asks for them — and only
  // for a signed-in reader; a visitor downloads nothing (`lib/rum.js`).
  if (config?.rum && getCachedUser()) {
    import("./lib/rum.js")
      .then(({ startRum }) => startRum())
      .catch(() => {
        /* offline first visit — measured next time */
      });
  }
});

// 言 · Pre-load this reader's language bundle BEFORE the React tree
// mounts — theirs alone: the three catalogues carry the same keys
// (`i18n/parity.test.js`), so English is no longer fetched underneath
// another language. Each language is its own
// code-split chunk, so visitors only download what they need — English
// users skip ~100 KB of FR/ES translations, etc. The await is bounded
// by the network round-trip on first visit; after that, the SW
// precache + browser cache make it instant. While this resolves, the
// inline boot script in index.html is already painting the right
// theme/accent so the user sees a styled splash immediately.
//
// 頁 · …and the page the address names, for the same reason. Its chunk
// is already on the way (`index.html` modulepreloads it); waiting for it
// here means the first render draws the page itself. Rendered before it,
// the page suspends, the router's loading screen is committed, and
// React keeps it up for 300 ms however soon the page is ready
// (`lib/lazyRoute.js`). The wait is capped: a page that is slow to come
// renders through its loading screen as before.
const PAGE_WAIT_MS = 1000;
const pageReady = preloadPageFor(window.location.pathname);
Promise.all([
  loadLanguage(bootstrapLanguage()),
  pageReady &&
    Promise.race([
      pageReady,
      new Promise((resolve) => setTimeout(resolve, PAGE_WAIT_MS)),
    ]),
]).then(() => {
  const root = document.getElementById("root");
  noteBootShell(root);
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
});
