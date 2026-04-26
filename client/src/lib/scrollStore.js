/**
 * 巻 · Per-history-entry scroll-position store.
 *
 * React Router by itself does not restore scroll on back-navigation in
 * the declarative `<Routes>` API — `<ScrollRestoration>` only ships
 * with the data router. We get the same UX with a tiny module-level
 * Map keyed by `location.key`: the AppShell saves the current scrollY
 * on every scroll (throttled) and restores it on `POP` navigation.
 *
 * Module-level (not React state) on purpose:
 *   - Survives any individual component unmount.
 *   - Cleared on full reload, which is correct: a fresh tab has no
 *     prior history to restore from.
 *   - Bounded so a long browsing session doesn't leak unbounded
 *     entries — we cap the Map at MAX_ENTRIES with FIFO eviction.
 */

const MAX_ENTRIES = 80;
const _store = new Map();

export function saveScroll(key, y) {
  if (!key) return;
  // Re-set bumps insertion order so the entry stays "fresh" against
  // FIFO eviction below.
  if (_store.has(key)) _store.delete(key);
  _store.set(key, Math.round(y));
  // Drop the oldest entry once we exceed the cap. `Map` iteration is
  // insertion-order, so `keys().next().value` is the oldest.
  if (_store.size > MAX_ENTRIES) {
    const oldest = _store.keys().next().value;
    if (oldest) _store.delete(oldest);
  }
}

export function readScroll(key) {
  if (!key) return undefined;
  return _store.get(key);
}

export function clearScrollStore() {
  _store.clear();
}
