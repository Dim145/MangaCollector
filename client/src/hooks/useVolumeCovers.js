import { useQuery } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * Fetch the per-volume cover map for a series. Keys are volume numbers
 * (as strings, since they come from JSON), values are direct MangaDex
 * cover URLs.
 *
 * Server-side: 7-day Redis cache (shared with the cover-picker pool).
 * Client-side: 24h TanStack Query cache — opening the MangaPage
 * repeatedly won't re-fetch.
 *
 * Returns an empty object when the series has no MangaDex reference. The
 * consuming component should fall back to the regular number-badge design
 * for any volume without a cover.
 */
export function useVolumeCovers(mal_id) {
  return useQuery({
    queryKey: ["volume-covers", mal_id],
    enabled: mal_id != null,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/user/library/${mal_id}/volume-covers`,
      );
      return data?.covers ?? {};
    },
  });
}
