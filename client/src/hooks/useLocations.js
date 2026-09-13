import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheLocations, db } from "@/lib/db.js";
import { deriveListState } from "@/lib/queryState.js";

/**
 * 棚 · The places registry — Dexie first (works offline), refreshed
 * from `/api/user/locations`. Counts are not stored: the pages derive
 * them from the cached volumes so they are right offline too.
 */
export function useLocations() {
  const data = useLiveQuery(async () => {
    const rows = await db.locations.toArray();
    return rows.sort(
      (a, b) =>
        (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name),
    );
  }, []);

  const query = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data } = await axios.get("/api/user/locations");
      const rows = Array.isArray(data?.locations) ? data.locations : [];
      await cacheLocations(rows);
      return rows;
    },
  });

  return deriveListState(data, query);
}

/**
 * Registry writes — online only: a rename or a delete moves every tome
 * filed there on the server, so the volumes feed is refetched right
 * after (the realtime echo is scoped away from this client).
 */
export function useLocationMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["locations"] });
    qc.invalidateQueries({ queryKey: ["volumes-all"] });
    qc.invalidateQueries({ queryKey: ["volumes"] });
  };
  const create = useMutation({
    mutationFn: async ({ name, note }) =>
      (
        await axios.post("/api/user/locations", {
          name,
          note: note || undefined,
        })
      ).data,
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...patch }) =>
      (await axios.patch(`/api/user/locations/${id}`, patch)).data,
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id) =>
      (await axios.delete(`/api/user/locations/${id}`)).data,
    onSuccess: refresh,
  });
  return { create, update, remove };
}
