/*
 * 私 · The service-worker buckets that hold one account's images.
 *
 * Purged on logout, on a lost session and when another account signs in
 * on the device, so the next reader never sees the previous one's shelf
 * through the cache. The public buckets (`mal-covers`,
 * `mangadex-covers`, `app-assets`…) are left alone on purpose: they are
 * nobody's in particular, and outliving a logout is a warm cache for the
 * next reader.
 *
 * One list, read by every purge. It used to be written out three times
 * (`utils/auth.js`, `utils/axios.js`, `lib/db.js`), which is how a new
 * private bucket gets purged by one exit and not the others; a test
 * (`privateCaches.test.js`) checks it against the buckets `vite.config.js`
 * declares.
 */
export const PRIVATE_CACHE_NAMES = Object.freeze([
  "user-posters",
  "public-posters",
  // 印 · Shelf prints, `/api/user/snapshots/{id}/image`, kept a year.
  "snapshot-images",
  // 影 · Covers fetched through the operator's relay. The images are
  // public, but which covers this device asked for is the reader's
  // library.
  "relayed-covers",
  // 写 · The photos of the reader's shelves (`/api/user/locations/…`).
  "place-photos",
]);

/** Delete every private bucket. Best-effort and silent: a logout must not fail on it. */
export async function purgePrivateCaches() {
  if (typeof caches === "undefined") return;
  await Promise.all(
    PRIVATE_CACHE_NAMES.map((name) => caches.delete(name).catch(() => false)),
  ).catch(() => {});
}
