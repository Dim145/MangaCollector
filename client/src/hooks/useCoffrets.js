import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "@/utils/axios.js";
import { queryClient } from "@/lib/queryClient.js";

/**
 * Coffrets for a given manga. Online-only for now — creating/deleting a
 * coffret is a bulk DB operation, so we don't try to coalesce it through the
 * outbox like we do for per-volume edits. The hook invalidates `volumes` on
 * mutation so the per-volume UI refreshes automatically.
 */
export function useCoffretsForManga(mal_id) {
  return useQuery({
    queryKey: ["coffrets", mal_id],
    enabled: mal_id != null && mal_id >= 0, // skip for custom entries (mal_id < 0)
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/library/${mal_id}/coffrets`);
      return data;
    },
  });
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
