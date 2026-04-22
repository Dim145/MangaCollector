import { useQuery } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * Fetch every alternate cover MAL + MangaDex know about for a series.
 * Server-side cached 7 days in Redis; client cached 24h by TanStack Query
 * so opening the picker is instant after the first load.
 *
 * Works for BOTH positive mal_ids (MAL-sourced entries, optionally
 * cross-linked to MangaDex) AND negative mal_ids (custom entries created
 * via the MangaDex flow — their mangadex_id lives on the library row and
 * the server uses it transparently). The caller is responsible for not
 * opening the picker when no external reference exists at all.
 */
export function useCoverPool(mal_id) {
  return useQuery({
    queryKey: ["covers", mal_id],
    enabled: mal_id != null,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/library/${mal_id}/covers`);
      return data?.covers ?? [];
    },
  });
}
