import { useQuery } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 対照 · Compare my library with another user's public profile by slug.
 *
 * Returns the full payload from `/api/user/compare/{slug}`:
 *   - me / other : user cards (display name + hanko + series count)
 *   - shared     : series both libraries contain (by mal_id)
 *   - mine_only  : series only I have
 *   - their_only : series only they have (adult-filtered per their
 *                  public_show_adult flag on the other end)
 *
 * 404 surfaces `isError === true` with status 404 in `error.response`
 * so the page can render a "no such user" empty state without
 * retrying indefinitely.
 */
export function useCompare(slug) {
  const q = useQuery({
    queryKey: ["compare", slug],
    enabled: typeof slug === "string" && slug.length > 0,
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/user/compare/${encodeURIComponent(slug)}`,
      );
      return data;
    },
    staleTime: 60_000,
    retry: (count, err) => {
      const s = err?.response?.status;
      if (s === 404 || s === 400) return false;
      return count < 2;
    },
  });
  return {
    data: q.data,
    isLoading: q.isPending,
    isError: q.isError,
    error: q.error,
  };
}
