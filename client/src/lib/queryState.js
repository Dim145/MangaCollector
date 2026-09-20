/*
 * 状 · Loading-state derivation for the live-Dexie + React-Query
 * pattern shared by every list hook (useLibrary, useVolumesForManga,
 * useAllVolumes). The five returned flags encode a four-state ladder:
 *
 *   isInitialLoad   — Dexie hasn't answered yet OR Dexie is empty AND
 *                     a network fetch is in flight (cold-start path).
 *                     Use to render a skeleton.
 *   isRefetching    — Dexie has data, network is revalidating in the
 *                     background. No user-visible loader required.
 *   isEmpty         — Genuinely no data (fetch resolved, Dexie empty).
 *                     Use to render the empty state.
 *   isLoading       — Backwards-compat alias for `isInitialLoad`. Some
 *                     legacy call sites still consume this name.
 *   data            — `data ?? []` so the consumer never has to guard
 *                     for undefined.
 *
 * Extracted to break the duplicate-code pattern Qodana flagged across
 * three call sites — keeps the loading semantics identical instead of
 * letting the three copies drift over time.
 */

/**
 * @param {unknown[] | undefined} data - useLiveQuery result
 * @param {{ isPending: boolean, isFetching: boolean }} query - useQuery handle
 * @param {{ enabled?: boolean }} [opts] - `enabled: false` collapses
 *        `pending` so the "initial load" never engages on a hook that
 *        was disabled at the call site (e.g. `useVolumesForManga(null)`).
 *        Default `true` preserves the original semantics.
 */
export function deriveListState(data, query, opts = {}) {
  const enabled = opts.enabled ?? true;
  const safe = data ?? [];
  const dexieReady = data !== undefined;
  const pending = query.isPending && enabled;
  // 橋 · The network answered with rows a moment ago and Dexie, which
  // the queryFn wrote them into, has not emitted them yet. That window
  // is a few milliseconds long and it used to read as "empty": the
  // dashboard flashed its empty state between the skeleton and the
  // grid, and the series route once redirected in it. It is still the
  // initial load. The window is bounded in time so a genuinely emptied
  // cache next to a stale query result cannot keep a skeleton up.
  const settling =
    dexieReady &&
    safe.length === 0 &&
    Array.isArray(query.data) &&
    query.data.length > 0 &&
    typeof query.dataUpdatedAt === "number" &&
    Date.now() - query.dataUpdatedAt < SETTLE_WINDOW_MS;
  const loading = pending || settling;
  return {
    data: safe,
    isInitialLoad: !dexieReady || (safe.length === 0 && loading),
    isRefetching: query.isFetching && !pending && safe.length > 0,
    isEmpty: dexieReady && safe.length === 0 && !loading,
    isLoading: !dexieReady || (safe.length === 0 && loading),
  };
}

/** How long a fresh network answer may wait for Dexie before an empty
 *  cache is believed. Dexie emits in single-digit milliseconds. */
export const SETTLE_WINDOW_MS = 1500;
