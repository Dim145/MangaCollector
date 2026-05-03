import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import {
  cacheCalendarUpcoming,
  calendarUpcomingKey,
  db,
} from "@/lib/db.js";

/**
 * 暦 · Upcoming-volume calendar feed.
 *
 * Hybrid Dexie + React-Query so the CalendarPage stays usable
 * when the server is unreachable. Each `(from, until)` range is
 * cached as a single Dexie row keyed by `${from}__${until}` —
 * idempotent: the same range answers the same dataset, so we
 * just last-writer-win the cache.
 *
 * Read priority:
 *   1. Live Dexie row for the requested range — fires synchronously
 *      from the local store, gives an offline-first render path.
 *   2. Background `useQuery` that hits `/api/user/calendar/upcoming`
 *      and mirrors the response into Dexie via `cacheCalendarUpcoming`.
 *      The mirror re-fires the live query so the UI converges to
 *      server truth without an explicit invalidate.
 *
 * Subscribe URL minting + the ICS feed itself stay online-only
 * (separate hooks / endpoints) — they require server-issued
 * tokens that don't make sense to cache.
 *
 * Returns `{ releases, from, until, isLoading, isFetching, isError,
 *           refetch, source }`. `source` is `"cache" | "live" | null`
 *           and lets the page indicate when the rendered data is
 *           coming from the local cache (e.g. "Hors ligne · plan
 *           du yyyy-MM").
 */
export function useUpcomingCalendar({ from, until } = {}) {
  const fromKey = from ?? null;
  const untilKey = until ?? null;
  const cacheKey = calendarUpcomingKey(from, until);

  // Live Dexie cache. `undefined` = Dexie hasn't answered yet,
  // `null` = no row for this range, otherwise the cached row.
  const cached = useLiveQuery(
    () => db.calendarUpcoming.get(cacheKey),
    [cacheKey],
  );

  const query = useQuery({
    queryKey: ["calendar-upcoming", fromKey, untilKey],
    queryFn: async () => {
      const params = {};
      if (from) params.from = from;
      if (until) params.until = until;
      const { data } = await axios.get("/api/user/calendar/upcoming", {
        params,
      });
      // Mirror to Dexie so live-query consumers immediately see the
      // fresh data + offline reloads pick it up later.
      await cacheCalendarUpcoming(from, until, data);
      return data;
    },
    // Keep previous data visible while the next month loads. The
    // explicit `previousData` argument shape is required by
    // TanStack Query v5's placeholderData API; passing
    // `keepPreviousData` (the v4 sentinel) silently returns
    // undefined and breaks the smoothing.
    placeholderData: (previousData) => previousData,
    staleTime: 60_000,
  });

  // Choose the rendered payload + signal the source so the UI
  // can flag "stale, served from local cache" if needed.
  const livePayload = query.data ?? null;
  const cachedPayload = cached?.payload ?? null;
  const payload = livePayload ?? cachedPayload;
  const source = livePayload
    ? "live"
    : cachedPayload
      ? "cache"
      : null;

  return {
    releases: payload?.releases ?? [],
    from: payload?.from ?? null,
    until: payload?.until ?? null,
    // Block the loading skeleton only while BOTH Dexie hasn't
    // answered AND the network query is still pending. Once
    // Dexie resolves (with a row OR null), we stop "loading"
    // and either show data or the empty-state.
    isLoading: cached === undefined && query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError && !cachedPayload,
    refetch: query.refetch,
    source,
  };
}
