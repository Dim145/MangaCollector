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

/**
 * 来 · Add a manually-pencilled upcoming volume.
 *
 * Online-only (no outbox queueing). Adding an upcoming volume is rare
 * compared to per-volume toggles — gating on `online` keeps the flow
 * simple: the Modal disables the submit button when offline, so the
 * mutation never runs without a connection. On success we write the
 * server's response straight into Dexie so the live view updates
 * before the next React Query refetch lands.
 */
export function useAddUpcomingVolume() {
  return useMutation({
    mutationFn: async ({ mal_id, vol_num, release_date, release_isbn, release_url }) => {
      const { data } = await axios.post(
        `/api/user/library/${mal_id}/volumes/upcoming`,
        { vol_num, release_date, release_isbn, release_url },
      );
      // Persist immediately so useLiveQuery surfaces the row without
      // waiting for the next refetch / WS tick. `put` is upsert-safe
      // if the WS event raced us (same primary key wins).
      await db.volumes.put(data);
      return data;
    },
  });
}

/**
 * 来 · Edit the announce-side fields of a manual upcoming volume.
 * The drawer's "Status / Reading / Edition / Price / Store" axes go
 * through the regular `useUpdateVolume` path; this hook is dedicated
 * to the metadata that's specific to the upcoming state.
 */
export function useUpdateUpcomingVolume() {
  return useMutation({
    mutationFn: async ({ id, release_date, release_isbn, release_url }) => {
      // Plural `/volumes/{id}` — distinct namespace from the legacy
      // `/volume/{mal_id}` list endpoint (Axum router conflict otherwise).
      const { data } = await axios.patch(
        `/api/user/volumes/${id}/upcoming`,
        { release_date, release_isbn, release_url },
      );
      await db.volumes.put(data);
      return data;
    },
  });
}

/**
 * 消 · Delete a manual upcoming volume. The server refuses if
 * `origin !== "manual"`, so we mirror the same guard at the call
 * site (the drawer only surfaces the delete CTA on manual rows).
 */
export function useDeleteUpcomingVolume() {
  return useMutation({
    mutationFn: async ({ id }) => {
      // Plural `/volumes/{id}` — see comment in useUpdateUpcomingVolume.
      await axios.delete(`/api/user/volumes/${id}`);
      // Drop from Dexie so the live view loses the card immediately.
      // If the WS event re-arrives later carrying the same delete it's
      // a quiet no-op — Dexie's `delete` on a missing key is harmless.
      await db.volumes.delete(id);
      return { id };
    },
  });
}
