import { useQuery, useMutation } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheLibrary, db } from "@/lib/db.js";
import { queryClient } from "@/lib/queryClient.js";
import {
  enqueueLibraryDelete,
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
export function useAddManga() {
  return useMutation({
    mutationFn: async (manga) => {
      await enqueueLibraryUpsert(manga);
      return manga;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useDeleteManga() {
  return useMutation({
    mutationFn: async (mal_id) => {
      await enqueueLibraryDelete(mal_id);
      return mal_id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useUpdateManga() {
  return useMutation({
    mutationFn: async ({ mal_id, volumes }) => {
      await enqueueLibraryUpdateVolumes(mal_id, volumes);
      return { mal_id, volumes };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useUpdateVolumesOwned() {
  return useMutation({
    mutationFn: async ({ mal_id, nbOwned }) => {
      await enqueueLibraryVolumesOwned(mal_id, nbOwned);
      return { mal_id, nbOwned };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });
}
