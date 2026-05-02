import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 印影 Inei · Snapshot history hooks.
 *
 * The flow:
 *   1. The SPA renders the shelf via `lib/shelfSnapshot.js` →
 *      Blob (PNG, 1080×1350).
 *   2. POST /api/user/snapshots returns the freshly-created row
 *      (image_path = NULL).
 *   3. POST /api/user/snapshots/{id}/image multipart-uploads the
 *      blob; the response carries `has_image: true` so the gallery
 *      flips to "ready" without a refetch.
 *
 * Keeping the create + upload steps separate lets the SPA capture
 * an idempotent stats-only row even if the canvas render fails — a
 * bare timeline entry is still useful.
 */

const SNAPSHOTS_KEY = ["snapshots"];

export function useSnapshots() {
  return useQuery({
    queryKey: SNAPSHOTS_KEY,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get("/api/user/snapshots");
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useCreateSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, notes }) => {
      const body = { name };
      if (notes != null && notes !== "") body.notes = notes;
      const { data } = await axios.post("/api/user/snapshots", body);
      return data;
    },
    onSuccess: (created) => {
      qc.setQueryData(SNAPSHOTS_KEY, (prev) =>
        Array.isArray(prev) ? [created, ...prev] : [created],
      );
    },
  });
}

export function useUploadSnapshotImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, blob }) => {
      const fd = new FormData();
      fd.append("image", blob, `snapshot-${id}.png`);
      const { data } = await axios.post(
        `/api/user/snapshots/${id}/image`,
        fd,
      );
      return data;
    },
    onSuccess: (updated) => {
      qc.setQueryData(SNAPSHOTS_KEY, (prev) =>
        Array.isArray(prev)
          ? prev.map((s) => (s.id === updated.id ? updated : s))
          : prev,
      );
    },
  });
}

export function useDeleteSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await axios.delete(`/api/user/snapshots/${id}`);
      return id;
    },
    onSuccess: (id) => {
      qc.setQueryData(SNAPSHOTS_KEY, (prev) =>
        Array.isArray(prev) ? prev.filter((s) => s.id !== id) : prev,
      );
    },
  });
}
