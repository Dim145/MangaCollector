import axios from "@/utils/axios.js";
import { cacheAllVolumes, cacheLibrary, cacheSettings } from "@/lib/db.js";

/**
 * 核 · The three reads every signed-in page needs: the library, the
 * volumes, the settings. One definition each, shared by the hook that
 * renders them and by the prefetch that warms them.
 *
 * They used to be written twice. `App.prefetchCoreUserData` fetched
 * them with bare axios during idle time while the hooks asked React
 * Query for the same URLs under their own keys — two different
 * mechanisms, no shared cache, so every page load fetched all three
 * twice and wrote them into Dexie twice. On the seeded library that was
 * 2.2 MB of XHR per page where 1.1 would do, and the volumes response
 * alone is a megabyte.
 *
 * Going through `queryClient.prefetchQuery` with these exact keys is
 * what makes the second request disappear: a prefetch still in flight
 * is the promise the mounting hook awaits, and one already settled is
 * fresh data under `staleTime`, so the hook does not refetch at all.
 *
 * Each `queryFn` writes to Dexie before returning, because Dexie — not
 * the query cache — is what components render from.
 */
export const libraryQuery = {
  queryKey: ["library"],
  queryFn: async () => {
    const { data } = await axios.get("/api/user/library");
    await cacheLibrary(data);
    return data;
  },
};

export const allVolumesQuery = {
  queryKey: ["volumes-all"],
  queryFn: async () => {
    const { data } = await axios.get("/api/user/volume");
    await cacheAllVolumes(data);
    return data;
  },
};

export const settingsQuery = {
  queryKey: ["settings"],
  queryFn: async () => {
    const { data } = await axios.get("/api/user/settings");
    await cacheSettings(data);
    return data;
  },
};
