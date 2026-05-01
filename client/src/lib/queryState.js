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
  return {
    data: safe,
    isInitialLoad: !dexieReady || (safe.length === 0 && pending),
    isRefetching: query.isFetching && !pending && safe.length > 0,
    isEmpty: dexieReady && safe.length === 0 && !pending,
    isLoading: !dexieReady || (safe.length === 0 && pending),
  };
}
