import axios from "axios";
import { clearCachedUser } from "./auth.js";

const location = typeof window !== "undefined" ? window.location : undefined;

axios.defaults.baseURL =
  (location ? location.origin : undefined) || "http://localhost:5173";
axios.defaults.withCredentials = true;

/**
 * 機 · Session-loss recovery interceptor.
 *
 * When the server returns 401 from an authenticated endpoint, the
 * session this client was using has been revoked, expired, or the
 * user's account was deleted. The handler:
 *
 *   1. Wipes the cached user blob in localStorage so the UI can't
 *      keep painting "logged-in" state from stale data.
 *   2. Notifies the rest of the SPA via a `mc:session-lost` custom
 *      event — TanStack Query consumers can listen and reset their
 *      caches.
 *   3. Hard-navigates to `/log-in?lost=1` so the JS modules reload
 *      with a fresh state. A React Router push would keep the
 *      module-level latch (`sessionLostHandled`) and the TanStack
 *      cache around, opening the door to redirect loops.
 *
 * Suppressed for:
 *   - the OAuth flow endpoints (they handle their own 401)
 *   - public profile / health endpoints (they don't 401, but
 *     belt-and-braces)
 *   - any current path that's already public (no point bouncing
 *     the user off the landing or the public profile they're
 *     reading).
 */
let sessionLostHandled = false;
const PUBLIC_PATH_RE = /^\/(?:log-in|glossary|u\/|$)/;

function isAuthRelevant401(error) {
  if (!error?.response || error.response.status !== 401) return false;
  const url = error.config?.url ?? "";
  if (url.includes("/auth/oauth2/")) return false;
  if (url.includes("/api/public/")) return false;
  if (url.includes("/api/health")) return false;
  return true;
}

axios.interceptors.response.use(
  (res) => res,
  (error) => {
    if (sessionLostHandled) return Promise.reject(error);
    if (!isAuthRelevant401(error)) return Promise.reject(error);

    sessionLostHandled = true;

    // Drop the cached user immediately so anything reading it
    // synchronously (header avatar, ProtectedRoute) sees "logged out".
    try {
      clearCachedUser();
    } catch {
      /* ignore */
    }

    try {
      window.dispatchEvent(new CustomEvent("mc:session-lost"));
    } catch {
      /* dispatchEvent should never throw — defensive */
    }

    if (location && !PUBLIC_PATH_RE.test(location.pathname)) {
      // Hard reload so the module-level latch resets and TanStack's
      // cache rebuilds from a clean slate. `?lost=1` is a hook for
      // the login page to surface a "you were signed out" hint.
      window.location.replace("/log-in?lost=1");
    }

    return Promise.reject(error);
  },
);

export default axios;
