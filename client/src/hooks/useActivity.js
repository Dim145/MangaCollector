import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { db } from "@/lib/db.js";

/**
 * Live activity feed. Same pattern as other data hooks — Dexie is the
 * source of truth rendered in the UI, a background React Query fetch
 * refreshes it from the server.
 *
 * Entries are kept sorted newest-first by (created_on, id) DESC.
 */
export function useActivity(limit = 30) {
  const data = useLiveQuery(
    () => db.activity.orderBy("created_on").reverse().limit(limit).toArray(),
    [limit]
  );

  const query = useQuery({
    queryKey: ["activity", limit],
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/activity`, {
        params: { limit },
      });
      await db.transaction("rw", db.activity, async () => {
        await db.activity.clear();
        if (data?.length) await db.activity.bulkPut(data);
      });
      return data;
    },
  });

  const safe = data ?? [];
  const dexieReady = data !== undefined;
  const pending = query.isPending;

  return {
    data: safe,
    isInitialLoad: !dexieReady || (safe.length === 0 && pending),
    isEmpty: dexieReady && safe.length === 0 && !pending,
  };
}
