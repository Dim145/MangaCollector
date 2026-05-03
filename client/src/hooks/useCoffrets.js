import { useMutation, useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheCoffretsForManga, db } from "@/lib/db.js";
import {
  enqueueCoffretCreate,
  enqueueCoffretDelete,
  enqueueCoffretUpdate,
} from "@/lib/sync.js";

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

/**
 * 盒 · Offline-capable coffret create.
 *
 * Mints a temp negative id locally, writes the optimistic Dexie
 * coffret row + binds every volume in [vol_start, vol_end], and
 * queues a POST for sync. Returns a synthesized coffret-shaped
 * object so callers that read the mutation's `data` (e.g. the
 * AddCoffretModal post-success path that may navigate to the new
 * coffret) keep working in both online and offline cases.
 */
export function useCreateCoffret(mal_id) {
  return useMutation({
    mutationFn: async (payload) => {
      const tempId = await enqueueCoffretCreate(mal_id, payload);
      return {
        id: tempId,
        mal_id,
        name: payload.name,
        vol_start: payload.vol_start,
        vol_end: payload.vol_end,
        price: payload.price ?? null,
        store: payload.store ?? null,
      };
    },
  });
}

/**
 * 盒 · Offline-capable coffret update. The patch is applied
 * optimistically to Dexie + queued for sync via `enqueueCoffretUpdate`.
 * No direct axios call — `mutateAsync` resolves as soon as the
 * queue accepts the op.
 */
export function useUpdateCoffret() {
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      await enqueueCoffretUpdate(id, patch);
      return { id, ...patch };
    },
  });
}

/**
 * 盒 · Offline-capable coffret delete. Removes the local row +
 * un-binds linked volumes synchronously; the outbox carries the
 * server-side DELETE (or cancels the pending create if the
 * coffret never reached the server).
 */
export function useDeleteCoffret() {
  return useMutation({
    mutationFn: async (coffretId) => {
      await enqueueCoffretDelete(coffretId);
      return coffretId;
    },
  });
}
