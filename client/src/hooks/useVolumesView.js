import { useCallback, useSyncExternalStore } from "react";

/**
 * 帳 vs 棚 · Volumes view-mode preference.
 *
 * Two values, mutually exclusive:
 *   - "ledger" (帳) — the default, dense management list with prices,
 *     stores, edit affordances. The accountancy view of a collection.
 *   - "shelf"  (棚) — read-only cover wall. Bigger covers, denser grid,
 *     no metadata. The appreciation view.
 *
 * Stored in localStorage (`mc:volumes-view`) so the user picks once and
 * the choice carries across visits and across series. We deliberately
 * do NOT key it by manga — the user has a stable preference for *how*
 * they want to look at any collection, not a per-series mood.
 *
 * ## Why `useSyncExternalStore` (and not just `useState` + `useEffect`)
 *
 * The naive pattern (per-consumer `useState` synced from localStorage on
 * mount + `storage` event listener) has a subtle bug: the browser's
 * `storage` event only fires for OTHER tabs, never the current one. So
 * when the toggle on MangaPage calls `setMode`, the toggle's own state
 * flips, but a sibling consumer mounted on the same page (e.g. the
 * volumes grid that decides whether to render `<Volume>` or
 * `<VolumeShelfTile>`) keeps its stale state until a reload.
 *
 * `useSyncExternalStore` solves this by having all consumers share a
 * single subscription channel — when any one of them mutates the store,
 * a `notify()` call wakes every subscriber, including those in the same
 * React tree. Cross-tab sync still works because the `storage` event
 * triggers the same `notify`.
 */

const STORAGE_KEY = "mc:volumes-view";
const VALID = new Set(["ledger", "shelf"]);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : "ledger";
  } catch {
    return "ledger";
  }
}

// Shared in-tab subscriber list. Each `useSyncExternalStore` consumer
// adds itself here on mount and is woken whenever `notify()` is called
// — either by our own `setMode` (same tab) or by the `storage` listener
// (other tabs).
const subscribers = new Set();

function notify() {
  subscribers.forEach((cb) => cb());
}

function subscribe(callback) {
  subscribers.add(callback);
  const storageHandler = (event) => {
    if (event.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    subscribers.delete(callback);
    window.removeEventListener("storage", storageHandler);
  };
}

// SSR fallback. We don't render this hook on the server today, but
// providing the snapshot keeps `useSyncExternalStore` happy if we ever
// hydrate.
function getServerSnapshot() {
  return "ledger";
}

export function useVolumesView() {
  const mode = useSyncExternalStore(subscribe, readStored, getServerSnapshot);

  const setMode = useCallback((next) => {
    const safe = VALID.has(next) ? next : "ledger";
    try {
      // Persist explicitly when shelf, drop the key when reverting to
      // the default ledger so the storage stays clean.
      if (safe === "ledger") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, safe);
      }
    } catch {
      /* quota / private mode — runtime state still updates */
    }
    // Wake every consumer in the same tab (the `storage` event covers
    // other tabs but never fires for the tab that wrote the value).
    notify();
  }, []);

  return { mode, setMode };
}
