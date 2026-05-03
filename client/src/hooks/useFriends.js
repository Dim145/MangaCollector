import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { db } from "@/lib/db.js";

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
 *
 * Offline:
 *   - `useFollowList` mirrors to Dexie so the correspondents rail
 *     remains readable when the network drops.
 *   - The feed (`useFriendsFeed`) and the per-slug check
 *     (`useIsFollowing`) stay online-only — freshness matters
 *     more than availability for those surfaces.
 */

const FRIENDS_KEY = ["friends", "list"];
const FEED_KEY_BASE = ["friends", "feed"];
const FRIENDS_DEXIE_KEY = "user";

export function useFollowList() {
  // Dexie-cached projection — `cached` is the array we wrote on the
  // last successful fetch. Falls back to `query.data` while the
  // first fetch is in flight, then to `[]` so consumers can map
  // safely either way.
  const cached = useLiveQuery(async () => {
    const row = await db.friendsList.get(FRIENDS_DEXIE_KEY);
    return Array.isArray(row?.value) ? row.value : null;
  }, []);

  const query = useQuery({
    queryKey: FRIENDS_KEY,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get("/api/user/follows");
      const list = Array.isArray(data) ? data : [];
      // Mirror to Dexie so a subsequent offline render keeps the
      // rail populated. Cache-aside, last-writer-wins.
      try {
        await db.friendsList.put({ key: FRIENDS_DEXIE_KEY, value: list });
      } catch {
        /* Dexie write failure shouldn't block the response */
      }
      return list;
    },
    // Don't pile up retries when offline — Dexie has the last good
    // copy and reconnect-driven refetch will pick it up.
    retry: (failureCount, err) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return false;
      }
      return failureCount < 2 && err?.response?.status !== 401;
    },
  });

  // Compose: prefer fresh fetch result, fall back to Dexie cache,
  // then to empty array. `isLoading` is true only when neither is
  // available.
  return {
    ...query,
    data: query.data ?? cached ?? [],
    isLoading: query.isPending && cached == null,
  };
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
