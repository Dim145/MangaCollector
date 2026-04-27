import { useQuery } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 暦 · Upcoming-volume calendar feed.
 *
 * Reads `/api/user/calendar/upcoming?from=YYYY-MM&until=YYYY-MM` and
 * caches the result under `["calendar-upcoming", from, until]`. The
 * server is the only source of truth — unlike the library/volume
 * data hooks (which mirror to Dexie for offline reads), the calendar
 * is read-only and small enough that the round-trip is cheaper than
 * the bookkeeping.
 *
 * Cache strategy:
 *   - `staleTime: 60_000` matches the realtime-sync push cadence;
 *     when a SyncKind::Volumes event invalidates the underlying
 *     volumes query, this calendar query is also marked stale via
 *     the `realtime-sync` hook's broadcast path.
 *   - `placeholderData: keepPrevious` (via `previousData` shim) so
 *     month-to-month navigation keeps the prior month's grid on
 *     screen while the new fetch lands — avoids the empty-flash
 *     between Mar and Apr.
 *
 * Returns `{ releases, from, until, isLoading, isError, refetch }`.
 * `releases` is always an array (empty when no data) so consumers
 * can `.map` without nullish guards.
 */
export function useUpcomingCalendar({ from, until } = {}) {
  const fromKey = from ?? null;
  const untilKey = until ?? null;

  const query = useQuery({
    queryKey: ["calendar-upcoming", fromKey, untilKey],
    queryFn: async () => {
      const params = {};
      if (from) params.from = from;
      if (until) params.until = until;
      const { data } = await axios.get("/api/user/calendar/upcoming", {
        params,
      });
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

  return {
    releases: query.data?.releases ?? [],
    from: query.data?.from ?? null,
    until: query.data?.until ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}
