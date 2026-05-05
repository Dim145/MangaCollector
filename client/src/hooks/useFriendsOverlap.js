import { useQuery } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 友 · Social-graph overlap fetch — backs the Tomo section of the
 * StatsPage with two rails:
 *   - shared:  series the user owns AND ≥1 friend owns
 *   - latent:  series the user does NOT own AND ≥1 friend owns
 *
 * Online-only on purpose. Offline returns an empty payload via the
 * react-query default + the consumer's `isLoading` gate. Friend
 * graphs change rarely; staleTime 5 min is plenty.
 */

export const FRIENDS_OVERLAP_KEY = ["friends", "overlap"];

export function useFriendsOverlap({ enabled = true } = {}) {
  return useQuery({
    queryKey: FRIENDS_OVERLAP_KEY,
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get("/api/user/follows/overlap");
      return {
        shared: Array.isArray(data?.shared) ? data.shared : [],
        latent: Array.isArray(data?.latent) ? data.latent : [],
        friend_total:
          typeof data?.friend_total === "number" ? data.friend_total : 0,
      };
    },
    retry: (failureCount, err) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return false;
      }
      const status = err?.response?.status;
      if (status === 401 || status === 404) return false;
      return failureCount < 2;
    },
  });
}
