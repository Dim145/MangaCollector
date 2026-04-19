import Dexie from "dexie";

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
  // Server-mirrored tables
  library: "mal_id, name",
  volumes: "id, mal_id, vol_num, [mal_id+vol_num]",
  settings: "key",

  // Outbox (pending mutations)
  outboxLibrary: "mal_id, ts",
  outboxVolumes: "id, ts",
  outboxSettings: "key",
});

export const SETTINGS_KEY = "user";

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

/**
 * Wipe every trace of the current user from local storage. Used on logout
 * so the next visitor on this browser can't see residual data, even though
 * the server may still consider the session alive for a bit longer.
 */
export async function clearAllUserData() {
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
      ],
      async () => {
        await db.library.clear();
        await db.volumes.clear();
        await db.settings.clear();
        await db.outboxLibrary.clear();
        await db.outboxVolumes.clear();
        await db.outboxSettings.clear();
      }
    );
  } catch (err) {
    console.warn("[db] clearAllUserData failed:", err?.message);
  }
}
