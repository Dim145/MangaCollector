import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheAuthor, db } from "@/lib/db.js";
import { enqueueAuthorDelete, enqueueAuthorUpdate } from "@/lib/sync.js";

/**
 * 作家 · Author detail (photo, bio, birthday, MAL link).
 *
 * Hybrid Dexie + React-Query read path so the AuthorPage stays
 * useful offline:
 *   • The Dexie `authors` store holds the last-seen AuthorDetail
 *     for any author the user has visited. `useLiveQuery` makes
 *     it the primary render source — optimistic edits land here
 *     instantly and offline reads still resolve.
 *   • A backgrounded `useQuery` refetches `/api/authors/{mal_id}`
 *     on mount/focus when online. The response is mirrored into
 *     Dexie via `cacheAuthor`, which then re-fires the live query
 *     so the UI converges to server truth.
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
  // Live Dexie read — fires for both the cached row AND any
  // optimistic updates the SPA writes locally before the outbox
  // reconciles. `useLiveQuery` returns `undefined` until the
  // first read resolves; `null` would mean "row genuinely absent".
  const cached = useLiveQuery(
    () => (malId != null && malId !== 0 ? db.authors.get(malId) : null),
    [malId],
  );

  const query = useQuery({
    queryKey: ["author", malId],
    // Negative mal_ids are valid (custom authors); only skip when
    // we have no id at all or the slug is the sentinel zero.
    enabled: malId != null && malId !== 0,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get(`/api/authors/${malId}`);
      // Mirror the server's truth into Dexie so the live-query
      // consumers immediately see the fresh row.
      await cacheAuthor(data);
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

  // Prefer Dexie when it has data — even if the network call
  // succeeded, the Dexie row will already be the same row (the
  // queryFn just put it). Falling back to query.data covers the
  // case where Dexie is genuinely empty (first-ever visit AND
  // we're online + the network call resolved before useLiveQuery).
  // The `cached === undefined` check is the "Dexie hasn't answered
  // yet" gate; once it answers (with a row OR `null`/undefined for
  // missing) we trust it.
  return {
    data: cached ?? query.data ?? null,
    isLoading: cached === undefined && query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
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
      // Mirror into Dexie so the just-created author shows up
      // immediately to any live-query consumer (the navigate-to-
      // /author/{mal_id} that follows reads from this cache).
      await cacheAuthor(data);
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["author", data.mal_id], data);
    },
  });
}

/**
 * 作家 · Offline-capable PATCH on a custom author.
 *
 * Writes to Dexie + outbox via `enqueueAuthorUpdate`; the live-query
 * inside `useAuthorDetail` reflects the new name/about immediately.
 * The outbox flusher (`flushAuthors`) replays the PATCH against the
 * server when connectivity returns, then mirrors the canonical row
 * back into Dexie. No direct axios call — the mutation resolves as
 * soon as the queue is enqueued, which means `mutateAsync` works
 * fully offline.
 */
export function useUpdateAuthor() {
  return useMutation({
    mutationFn: async ({ mal_id, name, about }) => {
      await enqueueAuthorUpdate({ mal_id, name, about });
      return { mal_id, name, about };
    },
  });
}

/**
 * 作家 · Offline-capable DELETE on a custom author.
 *
 * Removes the Dexie row + queues an outbox `delete` op. The live
 * `useAuthorDetail` consumer immediately sees the row vanish so
 * the AuthorPage's `confirmDelete` modal can navigate away without
 * waiting for the network. On successful flush, `flushAuthors`
 * also triggers a `refetchLibrary` so embedded `author` refs in
 * the user's library rows reconcile to NULL.
 */
export function useDeleteAuthor() {
  return useMutation({
    mutationFn: async (malId) => {
      await enqueueAuthorDelete(malId);
      return malId;
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
      // Mirror into Dexie — useAuthorDetail's live query reads
      // from there, so without this the new image_url wouldn't
      // surface until the next page refresh.
      await cacheAuthor(data);
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
      await cacheAuthor(data);
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
      // Mirror the freshly-fetched MAL row into Dexie so the live
      // query consumers see the updated photo / favorites / etc.
      await cacheAuthor(data);
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["author", data.mal_id], data);
    },
  });
}
