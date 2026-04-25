import { useQuery, useMutation } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheLibrary, db } from "@/lib/db.js";
import {
  enqueueLibraryDelete,
  enqueueLibraryPatch,
  enqueueLibraryPoster,
  enqueueLibraryUpdateVolumes,
  enqueueLibraryUpsert,
  enqueueLibraryVolumesOwned,
} from "@/lib/sync.js";

/**
 * Live library read — always reads from Dexie (works offline).
 * Silently kicks off a background refetch when online.
 *
 * Loading states:
 *   - isInitialLoad : Dexie hasn't answered yet OR Dexie is empty AND a
 *                     network fetch is in flight (true on cold-start).
 *                     Use to show a skeleton instead of zero values.
 *   - isRefetching  : Dexie already has data, we're revalidating from the
 *                     server in the background. No user-visible loader
 *                     needed — just a subtle indicator if desired.
 *   - isEmpty       : Genuinely no data (fetch done, Dexie empty).
 *                     Use to show the empty state.
 */
export function useLibrary() {
  const data = useLiveQuery(() => db.library.toArray(), []);

  const query = useQuery({
    queryKey: ["library"],
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/library`);
      await cacheLibrary(data);
      return data;
    },
  });

  const safe = data ?? [];
  const dexieReady = data !== undefined;
  const pending = query.isPending;

  return {
    data: safe,
    isInitialLoad: !dexieReady || (safe.length === 0 && pending),
    isRefetching: query.isFetching && !pending && safe.length > 0,
    isEmpty: dexieReady && safe.length === 0 && !pending,
    // Backwards-compat alias — some call sites still use `isLoading`
    isLoading: !dexieReady || (safe.length === 0 && pending),
  };
}

export function useSearchLibrary(query) {
  return useQuery({
    queryKey: ["library-search", query],
    enabled: Boolean(query?.trim()),
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/library/search`, {
        params: { q: query },
      });
      return data;
    },
  });
}

/**
 * Optimistic add-to-library. Writes locally & queues for sync.
 * Returns the same mutation API as useMutation so callers can await.
 */
// Note on the missing `onSuccess: invalidateQueries(["library"])`: the
// optimistic Dexie write inside each `enqueueLibrary*` helper is what drives
// the UI (every consumer reads via `useLiveQuery`). Triggering a React Query
// refetch right after the mutation would race the outbox flush — the refetch
// would GET /api/user/library BEFORE the server has applied the PATCH, come
// back with stale data, and `cacheLibrary` (clear + bulkPut) would wipe the
// optimistic change. The user would see their edit reverted until the next
// navigation cycle. The sync runner handles eventual consistency: after
// `flushLibrary()` succeeds, `syncOutbox` calls `refetchLibrary()` which
// pulls the authoritative server state into Dexie.
export function useAddManga() {
  return useMutation({
    mutationFn: async (manga) => {
      await enqueueLibraryUpsert(manga);
      return manga;
    },
  });
}

export function useDeleteManga() {
  return useMutation({
    mutationFn: async (mal_id) => {
      await enqueueLibraryDelete(mal_id);
      return mal_id;
    },
  });
}

export function useUpdateManga() {
  return useMutation({
    mutationFn: async ({ mal_id, volumes }) => {
      await enqueueLibraryUpdateVolumes(mal_id, volumes);
      return { mal_id, volumes };
    },
  });
}

export function useUpdateVolumesOwned() {
  return useMutation({
    mutationFn: async ({ mal_id, nbOwned }) => {
      await enqueueLibraryVolumesOwned(mal_id, nbOwned);
      return { mal_id, nbOwned };
    },
  });
}

/**
 * 出版社 · Update the publisher / edition metadata on a library row.
 *
 * Same offline-first contract as the other library mutations — the
 * write lands in Dexie immediately and an outbox PATCH coalesces with
 * any pending op for the same series. Pass either field as `null` (or
 * empty string) to clear it.
 *
 * Both fields can be sent in the same call so a "switch from Glénat
 * standard to Glénat Perfect" is a single PATCH.
 */
export function useUpdateMangaMeta() {
  return useMutation({
    mutationFn: async ({ mal_id, publisher, edition }) => {
      const fields = {};
      if (publisher !== undefined) fields.publisher = publisher;
      if (edition !== undefined) fields.edition = edition;
      await enqueueLibraryPatch(mal_id, fields);
      return { mal_id, ...fields };
    },
  });
}

/**
 * Offline-first poster change — same optimistic-Dexie + outbox pattern as
 * the other library mutations. Used by the cover picker confirm flow.
 */
export function useSetPoster() {
  return useMutation({
    mutationFn: async ({ mal_id, url }) => {
      await enqueueLibraryPoster(mal_id, url);
      return { mal_id, url };
    },
  });
}
