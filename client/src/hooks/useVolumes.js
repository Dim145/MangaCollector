import { useMutation, useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheAllVolumes, cacheVolumesForManga, db } from "@/lib/db.js";
import { enqueueVolumeUpdate } from "@/lib/sync.js";

/** Live volumes for one manga, sorted by vol_num. */
export function useVolumesForManga(mal_id) {
  const data = useLiveQuery(async () => {
    if (mal_id == null) return [];
    const rows = await db.volumes.where("mal_id").equals(mal_id).toArray();
    return rows.sort((a, b) => a.vol_num - b.vol_num);
  }, [mal_id]);

  const query = useQuery({
    queryKey: ["volumes", mal_id],
    enabled: mal_id != null,
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/volume/${mal_id}`);
      await cacheVolumesForManga(mal_id, data);
      return data;
    },
  });

  const safe = data ?? [];
  const dexieReady = data !== undefined;
  const pending = query.isPending && mal_id != null;

  return {
    data: safe,
    isInitialLoad: !dexieReady || (safe.length === 0 && pending),
    isRefetching: query.isFetching && !pending && safe.length > 0,
    isEmpty: dexieReady && safe.length === 0 && !pending,
    isLoading: !dexieReady || (safe.length === 0 && pending),
  };
}

/** All volumes across the user's library (for /profile). */
export function useAllVolumes() {
  const data = useLiveQuery(() => db.volumes.toArray(), []);

  const query = useQuery({
    queryKey: ["volumes-all"],
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/volume`);
      await cacheAllVolumes(data);
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
    isLoading: !dexieReady || (safe.length === 0 && pending),
  };
}

/** Optimistic volume update. */
export function useUpdateVolume() {
  return useMutation({
    mutationFn: async (volume) => {
      await enqueueVolumeUpdate(volume);
      return volume;
    },
    // No `queryClient.invalidateQueries` here on purpose. The optimistic
    // Dexie write inside `enqueueVolumeUpdate` is what drives the UI — every
    // consumer reads volumes via `useLiveQuery`, which reacts to the Dexie
    // change instantly.
    //
    // Invalidating the React Query cache here would race the outbox flush:
    // the refetch would hit the server BEFORE the PATCH had been applied,
    // get stale data, and `cacheVolumesForManga` (delete-then-bulkPut) would
    // overwrite our optimistic update. The user would see the old value
    // until the next refresh, editing another volume, or the next hook
    // mount — exactly the reported bug.
  });
}
