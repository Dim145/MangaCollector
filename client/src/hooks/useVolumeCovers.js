import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheVolumeCoverMap, db } from "@/lib/db.js";

/**
 * 巻 · Per-volume cover map for a series. Keys are volume numbers
 * (as strings, since they come from JSON), values are direct
 * MangaDex cover URLs.
 *
 * Hybrid Dexie + React Query — opening MangaPage offline still
 * shows the per-volume covers the user has previously seen:
 *   1. `useLiveQuery` reads the cached map for this mal_id
 *      from `db.volumeCoverMaps`.
 *   2. `useQuery` refreshes from the server in background and
 *      mirrors the response into Dexie via `cacheVolumeCoverMap`.
 *   3. The actual image bytes are SW-cached at the
 *      `mangadex-covers` runtime rule, so the URLs in the map
 *      resolve instantly from the cache when offline.
 *
 * Server-side: 7-day Redis cache (shared with the cover-picker
 * pool). Client-side: indefinite Dexie cache + 24h TanStack
 * staleTime — opening the MangaPage repeatedly won't re-fetch.
 *
 * Returns an empty object when the series has no MangaDex reference.
 * The consuming component falls back to the regular number-badge
 * design for any volume without a cover.
 */
export function useVolumeCovers(mal_id) {
  const enabled = mal_id != null;

  const cached = useLiveQuery(
    () => (enabled ? db.volumeCoverMaps.get(mal_id) : null),
    [enabled, mal_id],
  );

  const query = useQuery({
    queryKey: ["volume-covers", mal_id],
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/user/library/${mal_id}/volume-covers`,
      );
      const covers = data?.covers ?? {};
      await cacheVolumeCoverMap(mal_id, covers);
      return covers;
    },
  });

  // Prefer the cached map. The shape returned matches the original
  // hook's contract — `data` is `{ [vol_num]: url }` — so callers
  // (MangaPage) keep working unchanged.
  const data = cached?.covers ?? query.data ?? {};

  return {
    data,
    isLoading: cached === undefined && query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
