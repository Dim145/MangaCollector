import axios from "axios";
import { clearCachedUser } from "./auth.js";

const location = typeof window !== "undefined" ? window.location : undefined;

// Dedicated axios instance — avoids mutating the global default that any
// transitive dependency might also import. Default export keeps its name
// so existing `import axios from "@/utils/axios"` callers don't change.
const http = axios.create({
  baseURL: (location ? location.origin : undefined) || "http://localhost:5173",
  withCredentials: true,
});

/**
 * 機 · Session-loss recovery interceptor.
 *
 * When the server returns 401 from an authenticated endpoint, the
 * session this client was using has been revoked, expired, or the
 * user's account was deleted. The handler:
 *
 *   1. Wipes the cached user blob in localStorage so the UI can't
 *      keep painting "logged-in" state from stale data.
 *   2. Purges Dexie + TanStack Query so private data of the now-
 *      revoked session can't bleed into a subsequent re-login on
 *      the same device.
 *   3. Notifies the rest of the SPA via a `mc:session-lost` custom
 *      event — slow consumers (analytics, sync runner) listen and
 *      tear themselves down.
 *   4. Hard-navigates to `/log-in?lost=1` so the JS modules reload
 *      with a fresh state. A React Router push would keep the
 *      module-level latch (`sessionLostHandled`) and cache around,
 *      opening the door to redirect loops.
 *
 * Suppressed for:
 *   - the OAuth flow endpoints (they handle their own 401)
 *   - public profile / health endpoints (they don't 401, but
 *     belt-and-braces)
 *   - any current path that's already public (no point bouncing
 *     the user off the landing or the public profile they're
 *     reading).
 *
 * 始末 · `sessionLostHandled` is a module-level latch that prevents
 * the same 401 burst from triggering N hard-reloads. It's reset by
 * `resetSessionLostLatch()` at the start of every fresh OAuth flow
 * — without that reset, a user who re-logs in WITHOUT a hard reload
 * (rare in practice, but possible) would have a future revocation
 * silently swallowed because the latch was sticky from the prior
 * session. Belt-and-braces: also bound the latch to a 30-second
 * window so a marathon SPA session can't carry a stale latch
 * indefinitely.
 */
let sessionLostHandled = false;
let sessionLostHandledAt = 0;
const SESSION_LOST_TTL_MS = 30_000;

/**
 * Allow-list of public routes that should NEVER trigger a redirect
 * to /log-in on a 401 — the user is already on a path that doesn't
 * require auth, so bouncing them is a worse UX than letting the
 * 401 propagate. Set membership is stricter than a regex and easier
 * to reason about as routes evolve.
 */
const PUBLIC_PATHS = new Set(["/", "/log-in", "/glossary"]);
function isPublicPath(pathname) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Public profile pages live under /u/<slug> — slug shape isn't
  // pinned here on purpose; anything under /u/ is by definition
  // un-authenticated readable.
  if (pathname.startsWith("/u/")) return true;
  return false;
}

/**
 * Reset the session-lost latch. Called at the start of a fresh OAuth
 * flow so a future revocation in the new session is detected and
 * handled instead of being silently swallowed.
 */
export function resetSessionLostLatch() {
  sessionLostHandled = false;
  sessionLostHandledAt = 0;
}

function isAuthRelevant401(error) {
  if (!error?.response || error.response.status !== 401) return false;
  const url = error.config?.url ?? "";
  if (url.includes("/auth/oauth2/")) return false;
  // /auth/user is the canonical "am I logged in?" probe — its 401 is
  // the answer to the question, not an unexpected revocation. Letting
  // it through here would race the dedicated handler in
  // `getAuthStatus()` and trigger a redirect on every cold load
  // following a session expiry.
  if (url.includes("/auth/user")) return false;
  if (url.includes("/api/public/")) return false;
  if (url.includes("/api/health")) return false;
  return true;
}

http.interceptors.response.use(
  (res) => res,
  (error) => {
    // Auto-expire a stale latch so a long-lived SPA session that's
    // been through one 401 isn't permanently deaf to future ones.
    if (
      sessionLostHandled &&
      Date.now() - sessionLostHandledAt > SESSION_LOST_TTL_MS
    ) {
      sessionLostHandled = false;
      sessionLostHandledAt = 0;
    }
    if (sessionLostHandled) return Promise.reject(error);
    if (!isAuthRelevant401(error)) return Promise.reject(error);

    sessionLostHandled = true;
    sessionLostHandledAt = Date.now();

    // Drop the cached user immediately so anything reading it
    // synchronously (header avatar, ProtectedRoute) sees "logged out".
    try {
      clearCachedUser();
    } catch {
      /* ignore */
    }

    // Tear down both client-side caches that would otherwise carry
    // private data across a re-login on the same device:
    //   - TanStack Query: in-memory query cache (covers, library,
    //     stats…). Cleared via the `mc:session-lost` event so this
    //     module doesn't have to import the QueryClient.
    //   - Dexie: persistent IDB outbox + library mirror. Wiped via
    //     the dynamic import below — done lazily because the dexie
    //     module is heavy and we don't want to pay the cost on
    //     every cold load just for the unlikely-401 path.
    try {
      window.dispatchEvent(new CustomEvent("mc:session-lost"));
    } catch {
      /* dispatchEvent should never throw — defensive */
    }
    import("@/lib/db.js")
      .then((mod) => mod.clearAllUserData?.())
      .catch(() => {
        /* dexie unavailable in some test environments — ignore */
      });
    // Service Worker caches that hold the just-revoked user's private
    // responses. Same buckets as `logout()` purges in auth.js — we
    // duplicate the list here rather than re-import to avoid a cycle
    // between axios.js and auth.js (auth.js already depends on axios).
    if (typeof caches !== "undefined") {
      Promise.all(
        ["user-posters", "public-posters"].map((name) =>
          caches.delete(name).catch(() => false),
        ),
      ).catch(() => {
        /* defensive — Promise.all on an array of catch'd promises
           cannot reject, but TypeScript / future refactors might
           change that. */
      });
    }

    if (location && !isPublicPath(location.pathname)) {
      // Hard reload so the module-level latch resets and TanStack's
      // cache rebuilds from a clean slate. `?lost=1` is a hook for
      // the login page to surface a "you were signed out" hint.
      window.location.replace("/log-in?lost=1");
    }

    return Promise.reject(error);
  },
);

export default http;
