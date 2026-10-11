import axios from "@/utils/axios.js";
import {
  applyVolumesDelta,
  cacheAllVolumes,
  cacheLibrary,
  cacheSettings,
  db,
} from "@/lib/db.js";

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
 *
 * 同 · The two big ones do not even parse an answer they already have.
 * The server tags every JSON GET with a weak `ETag` (see the Rust
 * `http_cache` module), so a reload asks the browser's cache, gets a
 * 304, and hands us the same bytes with the same tag. Those bytes cost
 * 170 ms to parse and 130 ms to write into Dexie on a seeded library —
 * twice, on every page — for rows already sitting there. Comparing the
 * tag against the last one we stored skips both.
 *
 * The response is fetched as text and parsed by hand for that reason:
 * asking axios for JSON parses the megabyte before we can look at the
 * tag. The row count guards the skip — a cache wiped for any reason
 * (another account signing in, a purge) must be refilled even when the
 * server's answer has not changed.
 */

const TAG_PREFIX = "mc:etag:";

function lastTag(key) {
  try {
    return localStorage.getItem(TAG_PREFIX + key);
  } catch {
    return null;
  }
}

/**
 * 忘 · Drop the tag remembered for `key`, so the next fetch writes the
 * table even when the server's answer has not changed. A revert needs
 * exactly that: after the server refused an optimistic edit, its answer
 * is the one we already hold, and only rewriting the rows undoes the
 * edit sitting in Dexie.
 */
export function forgetTag(key) {
  rememberTag(key, null);
}

function rememberTag(key, tag) {
  try {
    if (tag) localStorage.setItem(TAG_PREFIX + key, tag);
    else localStorage.removeItem(TAG_PREFIX + key);
  } catch {
    /* private mode — the skip simply never applies */
  }
}

/**
 * GET `url` as text and parse it, unless its `ETag` says we already
 * hold the answer — in which case nothing is parsed and nothing is
 * written. `table` is what must be non-empty for that to be true.
 */
async function fetchUnlessUnchanged(key, url, table, write, onResponse) {
  const res = await axios.get(url, {
    responseType: "text",
    transformResponse: [(body) => body],
  });
  onResponse?.(res);
  const tag = res.headers?.etag ?? res.headers?.ETag ?? null;

  if (tag && tag === lastTag(key)) {
    const held = await table.count().catch(() => 0);
    if (held > 0) return { unchanged: true, rows: held };
  }

  const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  await write(data);
  rememberTag(key, tag);
  return data;
}
export const libraryQuery = {
  queryKey: ["library"],
  queryFn: () =>
    fetchUnlessUnchanged(
      "library",
      "/api/user/library",
      db.library,
      cacheLibrary,
    ),
};

/*
 * 差 · The volumes are refreshed as a delta once the device knows where
 * it stands. A full read answers with the revision it was taken at
 * (`X-Volume-Rev`); from then on the device asks only for what changed
 * after it, plus the ids that still exist — a few rows instead of every
 * tome, which a seeded shelf parsed in 170 ms on each change another
 * device made. The revision is kept beside the ETags, so whatever wipes
 * those (another account, a purge) sends the next refresh back to a
 * full read.
 */
const REV_KEY = "volumes-rev";

async function fetchVolumeDelta(since) {
  let res;
  try {
    res = await axios.get("/api/user/volume", { params: { since } });
  } catch (error) {
    // A revision this server does not take: start again from a full read.
    if (error?.response?.status === 400) {
      forgetTag(REV_KEY);
      return null;
    }
    throw error;
  }
  const body = res.data;
  if (!body || !Array.isArray(body.changed) || !Array.isArray(body.ids)) {
    // A server that predates deltas answered with the full list.
    forgetTag(REV_KEY);
    return null;
  }
  await applyVolumesDelta(body);
  rememberTag(REV_KEY, String(body.rev));
  return { delta: true, changed: body.changed.length, rows: body.ids.length };
}

export const allVolumesQuery = {
  queryKey: ["volumes-all"],
  queryFn: async () => {
    const since = lastTag(REV_KEY);
    if (since != null && /^\d+$/.test(since)) {
      const held = await db.volumes.count().catch(() => 0);
      if (held > 0) {
        const delta = await fetchVolumeDelta(since);
        if (delta) return delta;
      }
    }
    return fetchUnlessUnchanged(
      "volumes",
      "/api/user/volume",
      db.volumes,
      cacheAllVolumes,
      (res) => {
        const rev = res.headers?.["x-volume-rev"];
        if (rev != null && /^\d+$/.test(String(rev))) rememberTag(REV_KEY, String(rev));
        else forgetTag(REV_KEY);
      },
    );
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
