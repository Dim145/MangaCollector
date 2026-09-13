/*
 * 主 · Who the local caches belong to.
 *
 * Everything the PWA stores on the device — the Dexie library, the
 * volume rows, the offline outbox, the Service-Worker poster buckets —
 * is one account's private data, but none of it carries an owner. As
 * long as a logout wipes the device that is fine; the moment two
 * accounts share a browser and one of them never got a clean logout
 * (still offline when the session died, or someone just navigated to
 * `/log-in` and signed in as themselves), the next account inherits
 * the previous one's shelf *and* the previous one's queued writes,
 * which then flush under the new cookie and land in the wrong library.
 *
 * So we stamp the device with the user id the caches were filled for.
 * `adoptOwner()` is the only way in: it wipes first and stamps second
 * whenever the id it is handed is not the one on record. The stamp
 * lives in `localStorage` — the same storage `mc:auth-user` uses, and
 * readable synchronously from both the auth layer and the sync layer
 * without either importing the other.
 *
 * Not a security boundary: the session cookie is, and the server
 * re-authorises every request. This only stops one user's *local*
 * state from being presented — or replayed — as another's.
 */

const OWNER_KEY = "mc:owner";

/** The user id the local caches were filled for, or null if unstamped. */
export function readOwner() {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

/** Stamp the device for `id`. Pass anything id-shaped; stored as a string. */
export function writeOwner(id) {
  if (id == null) return;
  try {
    localStorage.setItem(OWNER_KEY, String(id));
  } catch {
    /* quota, Safari private mode — silent, same as the auth cache */
  }
}

/** Forget the stamp — part of a logout's wipe. */
export function clearOwner() {
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * True when the device is stamped for somebody other than `id`.
 * An unstamped device (first run, or an upgrade from a build that
 * predates the stamp) belongs to whoever asks — wiping there would
 * throw away a legitimately queued offline session.
 */
export function isForeignOwner(id) {
  if (id == null) return false;
  const current = readOwner();
  return current != null && current !== String(id);
}
