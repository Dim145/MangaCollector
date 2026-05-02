import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 友 Tomo · Friends + activity feed hooks.
 *
 * The model is "subscribe to public profiles, see their activity in
 * a feed". Three React-Query keys:
 *   - ["friends", "list"]        list of users I follow
 *   - ["friends", "feed", limit] aggregated activity
 *   - ["friends", "check", slug] follow-state of one slug
 *
 * Mutations invalidate the relevant keys so the SPA stays consistent
 * across the friends page, public profile follow button, and any
 * future correspondents widget.
 */

const FRIENDS_KEY = ["friends", "list"];
const FEED_KEY_BASE = ["friends", "feed"];

export function useFollowList() {
  return useQuery({
    queryKey: FRIENDS_KEY,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get("/api/user/follows");
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useFriendsFeed(limit = 50) {
  return useQuery({
    queryKey: [...FEED_KEY_BASE, limit],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/user/follows/feed?limit=${limit}`,
      );
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useIsFollowing(slug) {
  return useQuery({
    queryKey: ["friends", "check", slug],
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get(
        `/api/user/follows/${encodeURIComponent(slug)}/check`,
      );
      return Boolean(data?.following);
    },
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status === 401 || status === 404) return false;
      return failureCount < 2;
    },
  });
}

export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slug) => {
      await axios.post(`/api/user/follows/${encodeURIComponent(slug)}`);
      return slug;
    },
    onSuccess: (slug) => {
      qc.setQueryData(["friends", "check", slug], true);
      qc.invalidateQueries({ queryKey: FRIENDS_KEY });
      qc.invalidateQueries({ queryKey: FEED_KEY_BASE });
    },
  });
}

export function useUnfollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slug) => {
      await axios.delete(`/api/user/follows/${encodeURIComponent(slug)}`);
      return slug;
    },
    onSuccess: (slug) => {
      qc.setQueryData(["friends", "check", slug], false);
      qc.invalidateQueries({ queryKey: FRIENDS_KEY });
      qc.invalidateQueries({ queryKey: FEED_KEY_BASE });
    },
  });
}
