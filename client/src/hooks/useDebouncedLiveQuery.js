import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

/**
 * 緩 · `useLiveQuery` with a trailing-edge debounce.
 *
 * Why
 * ---
 * Dexie's `useLiveQuery` fires on EVERY observable mutation of
 * the tables it touches. For a single-volume toggle that's fine,
 * but bursts collapse poorly:
 *
 *   • Bulk-mark of 50 volumes — Dexie batches its
 *     `bulkPut` into one observable tick, so this is OK.
 *   • Rapid individual clicks (user toggling 5 vols in 200 ms)
 *     — fires 5 separate ticks → 5 React renders → 5 downstream
 *     analytics recomputations (each ~150 ms even with
 *     `useDeferredValue` deprioritising the work).
 *   • WebSocket sync receiving an unrelated update — clobbers
 *     the table again because `cacheAllVolumes` does a clear +
 *     bulkPut, and even though the data is identical, React
 *     gets a new array reference.
 *
 * The trailing-edge debounce settles those bursts into a single
 * React update. The first ever value lands immediately (initial
 * load shouldn't wait for the debounce window) but subsequent
 * updates wait `debounceMs` before the snapshot moves forward —
 * if another mutation fires inside the window, the timer resets.
 *
 * Trade-off: a single isolated mutation now feels "delayed" by
 * `debounceMs`. For analytics reads (the canonical caller) that
 * lag is invisible — no user is staring at the chart counting
 * frames. For interactive paths (Dashboard live filtering) we
 * use the regular `useLiveQuery` and skip this wrapper.
 *
 * Picking the debounce window
 * ---------------------------
 * 80 ms is the sweet spot we tuned for. Below 50 ms the burst
 * window is too short to coalesce rapid clicks (humans tap at
 * ~150 ms intervals when interacting fast). Above 150 ms the
 * delay starts being perceptible on isolated mutations. 80 ms
 * sits in the "imperceptible to the eye" band while comfortably
 * coalescing multi-click bursts.
 *
 * @param {() => Promise<T> | T} queryFn  Same shape `useLiveQuery` accepts.
 * @param {ReadonlyArray<unknown>} deps   Same shape `useLiveQuery` accepts.
 * @param {number} debounceMs             Trailing window; defaults to 80.
 * @returns {T | undefined}               The debounced snapshot.
 */
export function useDebouncedLiveQuery(queryFn, deps, debounceMs = 80) {
  const raw = useLiveQuery(queryFn, deps);
  // The snapshot we hand back. Initialised to `raw` so the very
  // first render returns whatever Dexie has settled on (often
  // `undefined` while it loads, which is the correct sentinel).
  const [snapshot, setSnapshot] = useState(raw);

  useEffect(() => {
    // Initial-load fast path: as soon as Dexie hands us the
    // first non-undefined value, flush it without waiting for
    // the debounce window. Otherwise the user pays the debounce
    // tax on cold-start, which has no upside.
    if (snapshot === undefined && raw !== undefined) {
      setSnapshot(raw);
      return undefined;
    }
    // Already in sync — nothing to do. This branch is the
    // common case when `raw` flips back to a previously-seen
    // value (rare but possible via clear-then-bulkPut).
    if (raw === snapshot) return undefined;
    // Trailing-edge debounce. Cleanup cancels the timer if a
    // new `raw` arrives before the window expires, restarting
    // the wait — that's how bursts collapse to one update.
    const timer = setTimeout(() => setSnapshot(raw), debounceMs);
    return () => clearTimeout(timer);
  }, [raw, snapshot, debounceMs]);

  return snapshot;
}
