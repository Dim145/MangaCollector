import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 作家 · Author detail (photo, bio, birthday, MAL link).
 *
 * Lazy-fetched against `GET /api/authors/{mal_id}`. The backend
 * routes by sign of mal_id:
 *   • positive → shared MAL row (cache-aside over Jikan)
 *   • negative → custom row owned by the caller
 * Both paths are cheap on repeat visits — postgres already has the
 * row.
 *
 * Disabled only when `mal_id` is null/undefined or zero (no author
 * resolved yet, or malformed slug). Callers should fall back to the
 * bare-name UI in that case rather than treating the absent detail
 * as an error.
 *
 * 24h staleTime = the detail rarely changes month-to-month and the
 * backend already revalidates server-side at ≥ 7d, so the SPA layer
 * just needs enough caching to avoid refetching when the user
 * switches tabs and comes back.
 */
export function useAuthorDetail(malId) {
  return useQuery({
    queryKey: ["author", malId],
    // Negative mal_ids are valid (custom authors); only skip when
    // we have no id at all or the slug is the sentinel zero.
    enabled: malId != null && malId !== 0,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get(`/api/authors/${malId}`);
      return data;
    },
    // 404 (no MAL profile) is a meaningful negative answer — treat it
    // as an empty result, not an error to retry. Other failures
    // bubble up so the caller can show a generic fallback.
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status === 404) return false;
      return failureCount < 2;
    },
  });
}

/**
 * 作家 · Custom-author CRUD mutations.
 *
 * All four hooks call the canonical author endpoints and invalidate
 * the React Query cache so any AuthorPage / dashboard widget reading
 * `["author", malId]` picks up the new shape on next render. The
 * library cache is also invalidated on `delete` since unlinking
 * nulls out `user_libraries.author_id` on every affected row.
 */
export function useCreateAuthor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, about }) => {
      const { data } = await axios.post("/api/authors", { name, about });
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["author", data.mal_id], data);
    },
  });
}

export function useUpdateAuthor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mal_id, name, about }) => {
      const body = {};
      if (name !== undefined) body.name = name;
      if (about !== undefined) body.about = about;
      const { data } = await axios.patch(`/api/authors/${mal_id}`, body);
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["author", data.mal_id], data);
    },
  });
}

export function useDeleteAuthor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (malId) => {
      await axios.delete(`/api/authors/${malId}`);
      return malId;
    },
    onSuccess: (malId) => {
      qc.removeQueries({ queryKey: ["author", malId] });
      // The unlink touched user_libraries — refetch the library so
      // every consumer (dashboard, MangaPage, AuthorPage gallery)
      // picks up `author_id = NULL` (and consequently `author = null`
      // on the embedded ref) on the affected rows.
      qc.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useUploadAuthorPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mal_id, file }) => {
      const formData = new FormData();
      formData.append("photo", file);
      const { data } = await axios.post(
        `/api/authors/${mal_id}/photo`,
        formData,
      );
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["author", data.mal_id], data);
    },
  });
}

export function useDeleteAuthorPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (malId) => {
      const { data } = await axios.delete(`/api/authors/${malId}/photo`);
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["author", data.mal_id], data);
    },
  });
}

/**
 * 作家 · Force a fresh Jikan re-fetch for a shared MAL author.
 *
 * The `GET` path uses the cache-aside pattern with a 7-day staleness
 * window. This mutation bypasses that gate via the dedicated
 * `POST /api/authors/{mal_id}/refresh` endpoint — used by the
 * "refresh" button on shared MAL author pages, where the user
 * explicitly wants the latest photo / bio / favorites count.
 *
 * Refuses negative mal_ids server-side (custom authors have no
 * upstream source); we let that 4xx bubble up to the caller.
 */
export function useRefreshAuthor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (malId) => {
      const { data } = await axios.post(`/api/authors/${malId}/refresh`);
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["author", data.mal_id], data);
    },
  });
}
