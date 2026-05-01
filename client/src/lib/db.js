import Dexie from "dexie";
// Static import instead of a previous `await import("@/lib/queryClient.js")`:
// `queryClient.js` only depends on `@tanstack/react-query` (no import
// back into `db.js`), so the circular-dep worry that motivated the
// lazy import turned out to be unfounded. The static form silences the
// Vite build warning:
//   "dynamically imported by db.js but also statically imported by …,
//    dynamic import will not move module into another chunk"
// which happened because every TanStack consumer imports queryClient
// statically anyway.
import { queryClient } from "@/lib/queryClient.js";

/*
 * Local database — two roles:
 *
 *  1. Cache of server state (library, volumes, settings). The UI reads these
 *     tables reactively via useLiveQuery — so lists keep rendering even when
 *     offline, and updates propagate automatically.
 *
 *  2. Outbox of pending mutations. Each entity has at most one pending
 *     coalesced op — we store the desired final state, not a log of edits.
 *     The sync service flushes these tables when the network returns.
 *
 * Operation shapes in the outbox tables:
 *   outboxLibrary: { mal_id, op: 'upsert'|'delete'|'update-owned', payload, ts }
 *   outboxVolumes: { id, op: 'update', payload, ts }
 *   outboxSettings: { key: 'user', payload, ts }
 */

export const db = new Dexie("mangacollector");

db.version(1).stores({
  library: "mal_id, name",
  volumes: "id, mal_id, vol_num, [mal_id+vol_num]",
  settings: "key",
  outboxLibrary: "mal_id, ts",
  outboxVolumes: "id, ts",
  outboxSettings: "key",
});

// v2 — ISBN lookup cache (avoids re-hitting Google Books for the same barcode)
db.version(2).stores({
  library: "mal_id, name",
  volumes: "id, mal_id, vol_num, [mal_id+vol_num]",
  settings: "key",
  outboxLibrary: "mal_id, ts",
  outboxVolumes: "id, ts",
  outboxSettings: "key",
  isbnCache: "isbn, ts",
});

// v3 — `mal_id` index on outboxVolumes so deleting a manga can cascade-drop
// any pending per-volume ops (`enqueueLibraryDelete` queries by mal_id).
db.version(3).stores({
  library: "mal_id, name",
  volumes: "id, mal_id, vol_num, [mal_id+vol_num]",
  settings: "key",
  outboxLibrary: "mal_id, ts",
  outboxVolumes: "id, mal_id, ts",
  outboxSettings: "key",
  isbnCache: "isbn, ts",
});

// v4 — activity feed cache + MAL recommendations cache for /profile.
db.version(4).stores({
  library: "mal_id, name",
  volumes: "id, mal_id, vol_num, [mal_id+vol_num]",
  settings: "key",
  outboxLibrary: "mal_id, ts",
  outboxVolumes: "id, mal_id, ts",
  outboxSettings: "key",
  isbnCache: "isbn, ts",
  activity: "id, created_on",
  // One row per source series — stores the list of recommended manga with a
  // fetch timestamp so we can TTL the cache.
  malRecommendations: "mal_id, ts",
});

// v5 — character catalogue keyed by series mal_id, used by the avatar picker.
// Each row holds the full character list fetched from Jikan so the picker
// can render a grouped grid without re-hitting the API on every open.
db.version(5).stores({
  library: "mal_id, name",
  volumes: "id, mal_id, vol_num, [mal_id+vol_num]",
  settings: "key",
  outboxLibrary: "mal_id, ts",
  outboxVolumes: "id, mal_id, ts",
  outboxSettings: "key",
  isbnCache: "isbn, ts",
  activity: "id, created_on",
  malRecommendations: "mal_id, ts",
  mangaCharacters: "mal_id, ts",
});

// v6 — seals cache. Single row keyed by "user" holding the earned-seals
// list (just `{ code, earned_at }` tuples — the catalog itself lives in
// `lib/sealsCatalog.js` and is bundled at build time). `newly_granted`
// is NOT persisted here: it's a transient "what got unlocked this exact
// request" signal that drives the ceremony animation, and replaying it
// from cache would fire the same ceremony every mount after an unlock.
// See `useSeals` for the strip-before-cache discipline.
db.version(6).stores({
  library: "mal_id, name",
  volumes: "id, mal_id, vol_num, [mal_id+vol_num]",
  settings: "key",
  outboxLibrary: "mal_id, ts",
  outboxVolumes: "id, mal_id, ts",
  outboxSettings: "key",
  isbnCache: "isbn, ts",
  activity: "id, created_on",
  malRecommendations: "mal_id, ts",
  mangaCharacters: "mal_id, ts",
  seals: "key",
});

// v7 — user-defined tags table existed briefly in 2026-05 but was
// rolled back: the feature collided semantically with the existing
// `genres` axis (also user-editable on custom rows) and confused
// users. We bump to v7 and EXPLICITLY drop the table by passing
// `null` to the store name — Dexie deletes the IndexedDB store on
// upgrade for any browser that cached the previous schema.
db.version(7).stores({
  library: "mal_id, name",
  volumes: "id, mal_id, vol_num, [mal_id+vol_num]",
  settings: "key",
  outboxLibrary: "mal_id, ts",
  outboxVolumes: "id, mal_id, ts",
  outboxSettings: "key",
  outboxTags: null,
  isbnCache: "isbn, ts",
  activity: "id, created_on",
  malRecommendations: "mal_id, ts",
  mangaCharacters: "mal_id, ts",
  seals: "key",
});

// v8 — `outboxBulkMark` for the dashboard's bulk-actions bar. One
// pending op per series (PK on mal_id), so rapid re-clicks on the
// same series coalesce to the latest desired state instead of
// queueing every intermediate. `ts` index lets the flusher walk
// in chronological order across series so the server cascade
// applies in the same order the user produced.
db.version(8).stores({
  library: "mal_id, name",
  volumes: "id, mal_id, vol_num, [mal_id+vol_num]",
  settings: "key",
  outboxLibrary: "mal_id, ts",
  outboxVolumes: "id, mal_id, ts",
  outboxSettings: "key",
  outboxBulkMark: "mal_id, ts",
  isbnCache: "isbn, ts",
  activity: "id, created_on",
  malRecommendations: "mal_id, ts",
  mangaCharacters: "mal_id, ts",
  seals: "key",
});

// v9 — `streak` cache. Single row keyed by "user" holding the
// last-known StreakInfo from the server. Survives offline reload
// the same way `settings` and `seals` do, so the masthead chip
// renders immediately with cached numbers and the network refetch
// updates them in the background.
db.version(9).stores({
  library: "mal_id, name",
  volumes: "id, mal_id, vol_num, [mal_id+vol_num]",
  settings: "key",
  outboxLibrary: "mal_id, ts",
  outboxVolumes: "id, mal_id, ts",
  outboxSettings: "key",
  outboxBulkMark: "mal_id, ts",
  isbnCache: "isbn, ts",
  activity: "id, created_on",
  malRecommendations: "mal_id, ts",
  mangaCharacters: "mal_id, ts",
  seals: "key",
  streak: "key",
});

export const SETTINGS_KEY = "user";
export const STREAK_KEY = "user";

/** Replace the entire library cache. */
export async function cacheLibrary(library) {
  await db.transaction("rw", db.library, async () => {
    await db.library.clear();
    if (library?.length) await db.library.bulkPut(library);
  });
}

/** Replace volumes for a given mal_id. */
export async function cacheVolumesForManga(mal_id, volumes) {
  await db.transaction("rw", db.volumes, async () => {
    await db.volumes.where("mal_id").equals(mal_id).delete();
    if (volumes?.length) await db.volumes.bulkPut(volumes);
  });
}

/** Replace all volumes (for /profile). */
export async function cacheAllVolumes(volumes) {
  await db.transaction("rw", db.volumes, async () => {
    await db.volumes.clear();
    if (volumes?.length) await db.volumes.bulkPut(volumes);
  });
}

/** Store / fetch the single settings row. */
export async function cacheSettings(settings) {
  if (!settings) return;
  await db.settings.put({ key: SETTINGS_KEY, ...settings });
}

export async function readSettings() {
  const row = await db.settings.get(SETTINGS_KEY);
  if (!row) return null;
  // eslint-disable-next-line no-unused-vars
  const { key, ...rest } = row;
  return rest;
}

/** 連 · Store / fetch the single streak row. Same shape as the
 *  server-side `StreakInfo`: { current_streak, best_streak,
 *  last_active_date }. */
export async function cacheStreak(streak) {
  if (!streak) return;
  await db.streak.put({ key: STREAK_KEY, ...streak });
}

export async function readStreak() {
  const row = await db.streak.get(STREAK_KEY);
  if (!row) return null;
  // eslint-disable-next-line no-unused-vars
  const { key, ...rest } = row;
  return rest;
}

/**
 * Wipe every trace of the current user from local storage.
 *
 * Used on logout (and the account-deletion flow) so the next visitor
 * on this browser can't see residual data even though the server may
 * still consider the session alive for a bit longer.
 *
 * Four storage surfaces to clean, not one:
 *   1. Dexie tables — library, volumes, settings, outbox, caches.
 *   2. Workbox runtime caches — the PWA service worker caches
 *      `/api/user/storage/poster/*` with StaleWhileRevalidate, so
 *      without clearing it user B briefly sees user A's covers.
 *   3. TanStack Query cache — in-memory but still holds the previous
 *      user's library/profile data until refetch.
 *   4. localStorage auth profile (`mc:auth-user`) — name/email/avatar
 *      that survives the redirect back to `/` unless explicitly
 *      removed.
 */
export async function clearAllUserData() {
  // 1) Dexie
  try {
    await db.transaction(
      "rw",
      [
        db.library,
        db.volumes,
        db.settings,
        db.outboxLibrary,
        db.outboxVolumes,
        db.outboxSettings,
        db.outboxBulkMark,
        db.activity,
        db.malRecommendations,
        db.mangaCharacters,
        db.seals,
        db.streak,
      ],
      async () => {
        await db.library.clear();
        await db.volumes.clear();
        await db.settings.clear();
        await db.outboxLibrary.clear();
        await db.outboxVolumes.clear();
        await db.outboxSettings.clear();
        await db.outboxBulkMark.clear();
        await db.activity.clear();
        await db.malRecommendations.clear();
        await db.mangaCharacters.clear();
        await db.seals.clear();
        await db.streak.clear();
      },
    );
  } catch (err) {
    console.warn("[db] clearAllUserData (Dexie) failed:", err?.message);
  }

  // 2) Workbox / service worker runtime caches. We delete ALL caches
  //    owned by this origin — the SW re-populates anything it still
  //    needs on the next navigation. Narrow filtering by name would
  //    be more surgical but risks missing caches if workbox config
  //    changes down the line.
  try {
    if (typeof caches !== "undefined" && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.warn("[db] clearAllUserData (caches) failed:", err?.message);
  }

  // 3) TanStack Query cache — see the static import at the top of the
  //    file for why this is no longer a `await import(...)`.
  try {
    queryClient.clear();
  } catch (err) {
    console.warn("[db] clearAllUserData (query cache) failed:", err?.message);
  }

  // 4) localStorage auth profile cache (`mc:auth-user` — see
  //    utils/auth.js). Can't call clearCachedUser() here because of
  //    the same circular-import risk; removing the key directly is
  //    safe and cheap.
  try {
    localStorage.removeItem("mc:auth-user");
  } catch {
    // Private/incognito modes may throw — not worth reporting.
  }
}
