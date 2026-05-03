import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheSnapshots, db } from "@/lib/db.js";

/**
 * 印影 Inei · Snapshot history hooks.
 *
 * Read path: hybrid Dexie + React Query.
 *   1. `useLiveQuery` on `db.snapshots` (sorted by `taken_at desc`
 *      via the secondary index) gives the gallery an offline-first
 *      render path. The user keeps seeing every print they've
 *      previously visited even when the server is unreachable.
 *   2. `useQuery` hits `/api/user/snapshots` in the background and
 *      mirrors the response into Dexie via `cacheSnapshots`. The
 *      mirror re-fires the live query so the UI converges to
 *      server truth.
 *   3. The matching image bytes (1080×1350 PNG per snapshot) are
 *      cached at the SW layer via a CacheFirst rule on
 *      `/api/user/snapshots/:id/image` — no Blob shuttle through
 *      IndexedDB needed.
 *
 * Write path: capture / upload / delete are NOT outboxed. Each
 * needs a server-minted id (capture) or talks to S3 (upload), both
 * of which don't replay cleanly through a queue. The SnapshotsPage
 * gates the relevant CTAs on `useOnline`.
 */

const SNAPSHOTS_KEY = ["snapshots"];

export function useSnapshots() {
  // Live cached data — undefined while Dexie hasn't answered,
  // [] when there are no snapshots.
  const cached = useLiveQuery(
    () => db.snapshots.orderBy("taken_at").reverse().toArray(),
    [],
  );

  const query = useQuery({
    queryKey: SNAPSHOTS_KEY,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get("/api/user/snapshots");
      const list = Array.isArray(data) ? data : [];
      // Mirror to Dexie so live consumers immediately see the
      // server's truth + offline reloads pick up where we left off.
      await cacheSnapshots(list);
      return list;
    },
  });

  // Render priority: live > query.data > [] (so consumers can
  // always `.map`). `cached === undefined` is "Dexie hasn't
  // resolved yet" — fall back to query.data in that brief window.
  const data = cached ?? query.data ?? [];

  return {
    data,
    // Block the loading skeleton only while Dexie hasn't answered
    // AND no network response has landed yet.
    isLoading: cached === undefined && query.isLoading,
    isFetching: query.isFetching,
    // Suppress error state when we have a cache fallback —
    // showing "the gallery failed" while we're rendering N
    // cached prints would be misleading.
    isError: query.isError && (!cached || cached.length === 0),
    refetch: query.refetch,
    // Tells the page whether data came from local cache vs. a
    // fresh round-trip — drives the "Mode hors ligne" banner.
    source: query.data ? "live" : cached ? "cache" : null,
  };
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
    onSuccess: async (created) => {
      // Mirror into Dexie so the live query immediately shows
      // the new (still image-less) row.
      await db.snapshots.put(created);
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
    onSuccess: async (updated) => {
      await db.snapshots.put(updated);
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
    onSuccess: async (id) => {
      await db.snapshots.delete(id);
      qc.setQueryData(SNAPSHOTS_KEY, (prev) =>
        Array.isArray(prev) ? prev.filter((s) => s.id !== id) : prev,
      );
    },
  });
}
