/**
 * 共有 · Deep-link intent vault.
 *
 * Two URL-driven entry points feed the same destination page (`/addmanga`):
 *
 *   1. PWA app shortcuts (`?shortcut=scan|library|...`) — the launcher
 *      menu shoves them through when the user long-presses the installed
 *      icon.
 *   2. Web Share Target (`?share_title=...&share_text=...&share_url=...`)
 *      — the OS share sheet lands here when MangaCollector is picked as
 *      the share recipient from another app.
 *
 * Both are *intents*: ephemeral signals that must be replayed on the
 * destination page once. The naive approach — read them straight from
 * `window.location.search` in AddPage — has two failure modes:
 *
 *   a) **OAuth round-trip eats the params.** If the user isn't signed
 *      in, `<ProtectedRoute>` redirects to `/log-in` BEFORE AddPage's
 *      `useEffect` ever runs. After login, AddPage mounts with no query
 *      string and the share / shortcut signal is lost.
 *
 *   b) **`Referer` leak risk.** While the URL still carries the share
 *      payload, any external navigation (the IdP redirect, e.g.) sends
 *      it as `Referer` to a third party. Shared text from another app
 *      is untrusted user data — it shouldn't be exfiltrated.
 *
 * The vault closes both holes:
 *
 *   - Captured at boot (`captureDeepLinkIntentFromUrl()` in `main.jsx`)
 *     BEFORE React mounts, so the params land in sessionStorage even
 *     when the user is bounced to login on the very next React tick.
 *   - URL is rewritten via `replaceState` immediately after capture, so
 *     the Referer of any subsequent navigation is clean.
 *   - AddPage reads the vault on mount via `consumeDeepLinkIntent()`,
 *     which clears the entry so a manual reload doesn't replay it.
 *
 * sessionStorage is the right scope: the intent is meaningful for the
 * current tab session only — opening MangaCollector in a fresh tab a
 * day later shouldn't replay yesterday's shared link.
 */

const SHARE_KEY = "mc:deeplink:share";
const SHORTCUT_KEY = "mc:deeplink:shortcut";

/** Parameters consumed from the URL — kept in one place so future
 *  additions (e.g. `?ref=...`) don't drift across modules. */
const URL_PARAMS = Object.freeze([
  "shortcut",
  "share_title",
  "share_text",
  "share_url",
]);

/** Whitelist of known shortcut ids — anything else is dropped on the
 *  floor so a craft URL can't smuggle arbitrary strings into the
 *  destination page's branch logic. */
const VALID_SHORTCUTS = new Set(["scan", "library"]);

/**
 * Read share/shortcut params from the current URL, persist them in
 * sessionStorage, and rewrite the URL to strip them. Idempotent —
 * calling twice with no params is a quiet no-op.
 *
 * Designed to run BEFORE React mounts, so the stash survives a
 * `<ProtectedRoute>` redirect to /log-in.
 *
 * Returns `true` if anything was captured (mostly for tests).
 */
export function captureDeepLinkIntentFromUrl() {
  if (typeof window === "undefined") return false;
  let captured = false;
  try {
    const params = new URLSearchParams(window.location.search);

    // Shortcut — single value, must be in the whitelist.
    const shortcut = params.get("shortcut");
    if (shortcut && VALID_SHORTCUTS.has(shortcut)) {
      try {
        sessionStorage.setItem(SHORTCUT_KEY, shortcut);
        captured = true;
      } catch {
        /* private mode / quota — silent */
      }
    }

    // Share target — three optional fields. Stored as a single JSON
    // blob so consumers don't have to reason about partial reads.
    const title = params.get("share_title");
    const text = params.get("share_text");
    const url = params.get("share_url");
    if (title || text || url) {
      try {
        sessionStorage.setItem(
          SHARE_KEY,
          JSON.stringify({ title, text, url }),
        );
        captured = true;
      } catch {
        /* ignore */
      }
    }

    // Strip every consumed param + rewrite the URL. We always
    // attempt the rewrite (even if `captured` stays false) because
    // a partial param might have been present without matching the
    // whitelist — leaving stray garbage in the address bar is poor
    // UX. `replaceState` doesn't push a history entry.
    let mutated = false;
    for (const k of URL_PARAMS) {
      if (params.has(k)) {
        params.delete(k);
        mutated = true;
      }
    }
    if (mutated) {
      const qs = params.toString();
      const path = window.location.pathname + (qs ? `?${qs}` : "");
      window.history.replaceState(null, "", path);
    }
  } catch {
    /* URL parsing failure — silent, don't crash the app boot */
  }
  return captured;
}

/** Read+clear the stashed shortcut intent, if any. */
export function consumeShortcutIntent() {
  try {
    const v = sessionStorage.getItem(SHORTCUT_KEY);
    if (v) sessionStorage.removeItem(SHORTCUT_KEY);
    return VALID_SHORTCUTS.has(v) ? v : null;
  } catch {
    return null;
  }
}

/** Read+clear the stashed share intent, if any. Returns the original
 *  `{ title, text, url }` shape (null fields preserved) or null. */
export function consumeShareIntent() {
  try {
    const raw = sessionStorage.getItem(SHARE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SHARE_KEY);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // Cap each field at a safe length to defuse anything weird that
    // slipped through (browsers don't bound share payloads, in theory).
    const clamp = (s) =>
      typeof s === "string" ? s.slice(0, 1024) : null;
    return {
      title: clamp(parsed.title),
      text: clamp(parsed.text),
      url: clamp(parsed.url),
    };
  } catch {
    return null;
  }
}

/** Peek at the share intent without consuming it. Used by AddPage's
 *  confirmation banner so the user sees the source URL/title before
 *  deciding to import or discard. */
export function peekShareIntent() {
  try {
    const raw = sessionStorage.getItem(SHARE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Drop the stashed share intent without consuming it through the
 *  normal flow — used by the "Discard" button in the confirmation
 *  banner so a future mount doesn't ask again. */
export function discardShareIntent() {
  try {
    sessionStorage.removeItem(SHARE_KEY);
  } catch {
    /* ignore */
  }
}
