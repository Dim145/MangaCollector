import { useMutation, useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { queryClient } from "@/lib/queryClient.js";
import { cacheCoffretsForManga, db } from "@/lib/db.js";

/**
 * 盒 · Coffrets for a given manga. Hybrid Dexie + React Query so
 * the MangaPage's coffret-grouped layout renders offline:
 *
 *   1. `useLiveQuery` reads `db.coffrets` filtered by mal_id.
 *      Returns the cached rows synchronously, before the network
 *      query lands.
 *   2. `useQuery` fetches `/api/user/library/{mal_id}/coffrets` in
 *      the background and mirrors the response into Dexie via
 *      `cacheCoffretsForManga`. Live consumers re-render once the
 *      mirror flushes.
 *
 * Mutations (create / update / delete) stay online-only: they're
 * bulk volume operations on the server that don't replay cleanly
 * through an outbox. The `online` gate at the call site (the
 * coffret editor opens from MangaPage) decides whether to render
 * the affordances at all.
 */
export function useCoffretsForManga(mal_id) {
  const enabled = mal_id != null && mal_id >= 0;

  const cached = useLiveQuery(
    () =>
      enabled
        ? db.coffrets.where("mal_id").equals(mal_id).toArray()
        : [],
    [enabled, mal_id],
  );

  const query = useQuery({
    queryKey: ["coffrets", mal_id],
    enabled,
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/library/${mal_id}/coffrets`);
      const list = Array.isArray(data) ? data : [];
      await cacheCoffretsForManga(mal_id, list);
      return list;
    },
  });

  // Render priority: Dexie if it's resolved (with rows OR empty
  // array), otherwise the network response, otherwise empty.
  const data = cached ?? query.data ?? [];

  return {
    data,
    isLoading: cached === undefined && query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError && (!cached || cached.length === 0),
    refetch: query.refetch,
  };
}

export function useCreateCoffret(mal_id) {
  return useMutation({
    mutationFn: async (payload) => {
      const { data } = await axios.post(
        `/api/user/library/${mal_id}/coffrets`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coffrets", mal_id] });
      queryClient.invalidateQueries({ queryKey: ["volumes", mal_id] });
      queryClient.invalidateQueries({ queryKey: ["volumes-all"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useUpdateCoffret(mal_id) {
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      const { data } = await axios.patch(`/api/user/coffrets/${id}`, patch);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coffrets", mal_id] });
    },
  });
}

export function useDeleteCoffret(mal_id) {
  return useMutation({
    mutationFn: async (coffretId) => {
      await axios.delete(`/api/user/coffrets/${coffretId}`);
      return coffretId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coffrets", mal_id] });
      queryClient.invalidateQueries({ queryKey: ["volumes", mal_id] });
    },
  });
}
