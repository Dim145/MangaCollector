import axios from "./axios";
import { clearAllUserData } from "@/lib/db.js";

/*
 * Auth strategy — survive server outages without bouncing the user to login.
 *
 * The real security boundary is the session cookie (HttpOnly, signed
 * server-side). Every API call is re-validated by the backend. The client
 * therefore caches the last known user profile purely for *UI* purposes
 * (ProtectedRoute, ProfileButton avatar, etc.) — no privilege is granted
 * by the cache itself.
 *
 * `getAuthStatus()` returns a 3-state discriminated result:
 *
 *   { kind: 'authenticated', user }   server said 200 → fresh truth
 *   { kind: 'cached',        user }   server unreachable BUT we had a valid
 *                                     profile from before → trust it for UI
 *   { kind: 'unauthenticated' }       server explicitly said 401/403 → clear
 *                                     cache, bounce to login
 *   { kind: 'unknown' }               server unreachable AND no cache → only
 *                                     happens on first-ever load while the
 *                                     backend is down
 *
 * Pending-logout flag:
 *   If the user clicks "Sign out" while the server is unreachable, the POST
 *   /auth/oauth2/logout never lands. The local cache is cleared immediately
 *   so the UI treats them as logged out, BUT the session cookie is still
 *   valid server-side. Until we've actually invalidated that cookie, we:
 *     - refuse to treat ANY /auth/user 200 as re-authenticated
 *     - retry the POST logout every time the server looks reachable
 *
 *   Flag cleared when:
 *     - POST logout succeeds
 *     - OR the user explicitly starts a new OAuth flow (intent overrides
 *       the pending logout — new session is born, old one will be orphaned
 *       naturally when its cookie expires)
 */

const AUTH_CACHE_KEY = "mc:auth-user";
const PENDING_LOGOUT_KEY = "mc:pending-logout";

function readCachedUser() {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.user ?? null;
  } catch {
    return null;
  }
}

function writeCachedUser(user) {
  try {
    localStorage.setItem(
      AUTH_CACHE_KEY,
      JSON.stringify({ user, ts: Date.now() })
    );
  } catch {
    /* quota, Safari private mode — silent */
  }
}

function clearCachedUser() {
  try {
    localStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function isLogoutPending() {
  try {
    return localStorage.getItem(PENDING_LOGOUT_KEY) !== null;
  } catch {
    return false;
  }
}

function setLogoutPending() {
  try {
    localStorage.setItem(PENDING_LOGOUT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function clearLogoutPending() {
  try {
    localStorage.removeItem(PENDING_LOGOUT_KEY);
  } catch {
    /* ignore */
  }
}

export const getCachedUser = readCachedUser;
export const hasPendingLogout = isLogoutPending;

/**
 * Attempt to deliver a queued logout. Safe to call any time — noop when no
 * flag is set. Sync runner calls this whenever the server becomes reachable.
 */
export async function flushPendingLogout() {
  if (!isLogoutPending()) return false;
  try {
    await axios.post("/auth/oauth2/logout", null, { timeout: 5000 });
    clearLogoutPending();
    return true;
  } catch (err) {
    // Still unreachable — try again next time.
    console.warn("[auth] pending logout flush failed:", err?.message);
    return false;
  }
}

/**
 * Resolve the current auth state. Distinguishes unreachable server from
 * genuine unauthenticated — so transient outages never evict the user.
 */
export const getAuthStatus = async () => {
  // If the user explicitly logged out but we never reached the server to
  // invalidate the session, treat them as unauthenticated — even if a stale
  // cookie would make /auth/user return 200. Background-flush the logout so
  // the server cleans up ASAP.
  if (isLogoutPending()) {
    flushPendingLogout().catch(() => {});
    return { kind: "unauthenticated" };
  }

  try {
    const response = await axios.get("/auth/user", { timeout: 5000 });
    if (response.status === 200 && response.data) {
      writeCachedUser(response.data);
      return { kind: "authenticated", user: response.data };
    }
    return { kind: "unauthenticated" };
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      clearCachedUser();
      return { kind: "unauthenticated" };
    }
    const cached = readCachedUser();
    if (cached) return { kind: "cached", user: cached };
    return { kind: "unknown" };
  }
};

/** Legacy shim — returns user OR null. */
export const checkAuthStatus = async () => {
  const result = await getAuthStatus();
  if (result.kind === "authenticated" || result.kind === "cached") {
    return result.user;
  }
  return null;
};

/**
 * Log the user out. Always clears local state immediately. If the server is
 * unreachable, sets a pending-logout flag so the call is retried as soon as
 * connectivity returns — until then, the UI refuses to treat the stale
 * cookie as authenticated.
 */
export const logout = async () => {
  // Always kill local state first — even if the server call fails, the UI
  // should never present user A's data to user B on this device.
  clearCachedUser();
  await clearAllUserData();

  try {
    await axios.post("/auth/oauth2/logout", null, { timeout: 5000 });
    clearLogoutPending();
  } catch (err) {
    // Queue it for later — handler will retry on connectivity recovery.
    setLogoutPending();
    console.warn("[auth] logout queued (server unreachable):", err?.message);
  }
};

/** Start the OAuth flow. */
export const initiateOAuth = () => {
  // Starting a fresh OAuth flow expresses intent to create a new session.
  // Any pending logout is moot — the old cookie will be replaced by the
  // new one anyway.
  clearLogoutPending();
  window.location.href = `${axios.defaults.baseURL}/auth/oauth2`;
};

/** Public OAuth provider info — no auth required. */
export const getAuthProvider = async () => {
  try {
    const response = await axios.get("/auth/provider");
    return response.data;
  } catch (error) {
    console.error("Failed to fetch auth provider:", error);
    return { authName: "", authIcon: "" };
  }
};
