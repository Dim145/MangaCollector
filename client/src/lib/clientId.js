/*
 * 源 · Per-tab client identity for the realtime channel.
 *
 * Every request carries this id in `X-Client-Id`, and the websocket
 * upgrade carries it as `?client_id=`. The server stamps it on the
 * `SyncEvent` a mutation produces and skips sending that event back
 * to the socket that caused it — this tab already holds the optimistic
 * state, so the echo only ever triggered a redundant full refetch.
 *
 * sessionStorage, not localStorage, on purpose: each tab owns one
 * socket, so each tab needs its own id. Two tabs of the same account
 * must still hear each other's changes.
 *
 * Opaque and unguessable, but not a secret and never trusted by the
 * server for anything but echo suppression (it is validated to
 * `[A-Za-z0-9_-]{8,64}` and otherwise ignored).
 */

const STORAGE_KEY = "mc:client-id";

let memo = null;

function generate() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Older WebViews: 24 chars of base36 from Math.random is plenty for
  // "which tab am I", which is all this needs to be.
  let out = "";
  while (out.length < 24) out += Math.random().toString(36).slice(2);
  return out.slice(0, 24);
}

/** Stable for the life of the tab; regenerated on a fresh tab. */
export function getClientId() {
  if (memo) return memo;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) {
      memo = stored;
      return memo;
    }
  } catch {
    /* storage unavailable — fall through to an in-memory id */
  }
  memo = generate();
  try {
    sessionStorage.setItem(STORAGE_KEY, memo);
  } catch {
    /* ignore — the in-memory id still works for this page lifetime */
  }
  return memo;
}

/** Test hook — forget the memoised id so the next call re-reads storage. */
export function _resetClientIdForTests() {
  memo = null;
}
