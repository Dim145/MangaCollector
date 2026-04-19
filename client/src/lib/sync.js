import axios from "@/utils/axios.js";
import { cacheLibrary, cacheVolumesForManga, cacheSettings, db } from "./db.js";
import {
  isFullyOnline,
  onConnectivityChange,
  probeServer,
} from "./connectivity.js";
import { queryClient } from "./queryClient.js";
import { flushPendingLogout, hasPendingLogout } from "@/utils/auth.js";

/*
 * Sync service — flushes the Dexie outbox tables to the backend.
 *
 * Design notes:
 *   - Operations are coalesced per entity, so each row in an outbox table is
 *     the single desired final state. We push it with one API call.
 *   - On success: remove the outbox row and refresh the mirror cache from
 *     the server response.
 *   - On failure:
 *       - 4xx (validation, auth, not found) → drop the op, refetch from
 *         server, surface an error toast. The UI will "revert" because the
 *         Dexie mirror now matches server state.
 *       - 5xx / network → leave in outbox for next retry. No user noise.
 */

const PENDING_CHANGED_EVENT = "mc:pending-changed";
const SYNC_ERROR_EVENT = "mc:sync-error";

let syncing = false;
let syncQueued = false;

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Count all pending ops across outbox tables. */
export async function pendingCount() {
  const [lib, vol, set] = await Promise.all([
    db.outboxLibrary.count(),
    db.outboxVolumes.count(),
    db.outboxSettings.count(),
  ]);
  return lib + vol + set;
}

export function notifyPendingChanged() {
  emit(PENDING_CHANGED_EVENT);
}

export function onPendingChanged(handler) {
  window.addEventListener(PENDING_CHANGED_EVENT, handler);
  return () => window.removeEventListener(PENDING_CHANGED_EVENT, handler);
}

export function onSyncError(handler) {
  window.addEventListener(SYNC_ERROR_EVENT, handler);
  return () => window.removeEventListener(SYNC_ERROR_EVENT, handler);
}

/*
 * ─── Library outbox operations ────────────────────────────────────────────
 */

export async function enqueueLibraryUpsert(manga) {
  await db.transaction("rw", db.library, db.outboxLibrary, async () => {
    await db.library.put(manga);
    await db.outboxLibrary.put({
      mal_id: manga.mal_id,
      op: "upsert",
      payload: manga,
      ts: Date.now(),
    });
  });
  notifyPendingChanged();
  triggerSync();
}

export async function enqueueLibraryDelete(mal_id) {
  await db.transaction(
    "rw",
    db.library,
    db.volumes,
    db.outboxLibrary,
    db.outboxVolumes,
    async () => {
      await db.library.delete(mal_id);
      await db.volumes.where("mal_id").equals(mal_id).delete();
      // Discard any pending volume ops for the deleted manga
      await db.outboxVolumes.where("mal_id").equals(mal_id).delete();
      await db.outboxLibrary.put({
        mal_id,
        op: "delete",
        ts: Date.now(),
      });
    }
  );
  notifyPendingChanged();
  triggerSync();
}

export async function enqueueLibraryUpdateVolumes(mal_id, volumes) {
  await db.transaction("rw", db.library, db.outboxLibrary, async () => {
    const existing = await db.library.get(mal_id);
    if (existing) await db.library.put({ ...existing, volumes });
    const current = (await db.outboxLibrary.get(mal_id)) ?? {
      mal_id,
      op: "patch",
      payload: {},
      ts: Date.now(),
    };
    current.payload = { ...current.payload, volumes };
    current.op = current.op === "upsert" ? "upsert" : "patch";
    current.ts = Date.now();
    await db.outboxLibrary.put(current);
  });
  notifyPendingChanged();
  triggerSync();
}

export async function enqueueLibraryVolumesOwned(mal_id, nbOwned) {
  await db.transaction("rw", db.library, db.outboxLibrary, async () => {
    const existing = await db.library.get(mal_id);
    if (existing) await db.library.put({ ...existing, volumes_owned: nbOwned });
    const current = (await db.outboxLibrary.get(mal_id)) ?? {
      mal_id,
      op: "owned",
      payload: {},
      ts: Date.now(),
    };
    current.payload = { ...current.payload, volumes_owned: nbOwned };
    // If we already have a stronger op (upsert/delete/patch), keep the
    // stronger one — owned count is merged into payload regardless.
    if (!current.op || current.op === "owned") current.op = "owned";
    current.ts = Date.now();
    await db.outboxLibrary.put(current);
  });
  notifyPendingChanged();
  triggerSync();
}

/*
 * ─── Volume outbox operations ─────────────────────────────────────────────
 */

export async function enqueueVolumeUpdate(volume) {
  await db.transaction("rw", db.volumes, db.outboxVolumes, async () => {
    await db.volumes.put(volume);
    await db.outboxVolumes.put({
      id: volume.id,
      mal_id: volume.mal_id,
      op: "update",
      payload: {
        owned: volume.owned,
        price: Number(volume.price) || 0,
        store: volume.store ?? "",
      },
      ts: Date.now(),
    });
  });
  notifyPendingChanged();
  triggerSync();
}

/*
 * ─── Settings outbox ──────────────────────────────────────────────────────
 */

export async function enqueueSettingsUpdate(settings) {
  await db.transaction("rw", db.settings, db.outboxSettings, async () => {
    const current = (await db.settings.get("user")) ?? { key: "user" };
    await db.settings.put({ ...current, ...settings });
    await db.outboxSettings.put({
      key: "user",
      payload: {
        currency: settings.currency?.code ?? settings.currency,
        titleType: settings.titleType,
        adult_content_level: settings.adult_content_level,
        theme: settings.theme,
        language: settings.language,
        avatarUrl: settings.avatarUrl,
      },
      ts: Date.now(),
    });
  });
  notifyPendingChanged();
  triggerSync();
}

/*
 * ─── Flushing ─────────────────────────────────────────────────────────────
 */

function isUnretriable(err) {
  const status = err?.response?.status;
  if (status == null) return false; // network error → retry
  return status >= 400 && status < 500;
}

async function flushLibrary() {
  const ops = await db.outboxLibrary.orderBy("ts").toArray();
  for (const op of ops) {
    try {
      if (op.op === "delete") {
        await axios.delete(`/api/user/library/${op.mal_id}`);
      } else if (op.op === "upsert") {
        await axios.post(`/api/user/library`, op.payload);
      } else if (op.op === "owned") {
        const n = op.payload.volumes_owned;
        await axios.patch(`/api/user/library/${op.mal_id}/${n}`);
      } else if (op.op === "patch") {
        await axios.patch(`/api/user/library/${op.mal_id}`, op.payload);
      }
      await db.outboxLibrary.delete(op.mal_id);
      notifyPendingChanged();
    } catch (err) {
      if (isUnretriable(err)) {
        await db.outboxLibrary.delete(op.mal_id);
        await refetchLibrary().catch(() => {});
        emit(SYNC_ERROR_EVENT, {
          op: "library",
          mal_id: op.mal_id,
          message: err?.response?.data?.error ?? err.message ?? "Sync failed",
        });
        notifyPendingChanged();
      } else {
        // retriable — stop the chain, try again later
        throw err;
      }
    }
  }
}

async function flushVolumes() {
  const ops = await db.outboxVolumes.orderBy("ts").toArray();
  for (const op of ops) {
    try {
      await axios.patch(`/api/user/volume`, {
        id: op.id,
        owned: op.payload.owned,
        price: op.payload.price,
        store: op.payload.store,
      });
      await db.outboxVolumes.delete(op.id);
      notifyPendingChanged();
    } catch (err) {
      if (isUnretriable(err)) {
        await db.outboxVolumes.delete(op.id);
        if (op.mal_id) await refetchVolumes(op.mal_id).catch(() => {});
        emit(SYNC_ERROR_EVENT, {
          op: "volume",
          id: op.id,
          message: err?.response?.data?.error ?? err.message ?? "Sync failed",
        });
        notifyPendingChanged();
      } else {
        throw err;
      }
    }
  }
}

async function flushSettings() {
  const ops = await db.outboxSettings.toArray();
  for (const op of ops) {
    try {
      const res = await axios.post(`/api/user/settings`, op.payload);
      await db.outboxSettings.delete(op.key);
      await cacheSettings(res.data);
      notifyPendingChanged();
    } catch (err) {
      if (isUnretriable(err)) {
        await db.outboxSettings.delete(op.key);
        await refetchSettings().catch(() => {});
        emit(SYNC_ERROR_EVENT, {
          op: "settings",
          message: err?.response?.data?.error ?? err.message ?? "Sync failed",
        });
        notifyPendingChanged();
      } else {
        throw err;
      }
    }
  }
}

async function refetchLibrary() {
  const { data } = await axios.get(`/api/user/library`);
  await cacheLibrary(data);
  queryClient.invalidateQueries({ queryKey: ["library"] });
  return data;
}

async function refetchVolumes(mal_id) {
  const { data } = await axios.get(`/api/user/volume/${mal_id}`);
  await cacheVolumesForManga(mal_id, data);
  queryClient.invalidateQueries({ queryKey: ["volumes", mal_id] });
  return data;
}

async function refetchSettings() {
  const { data } = await axios.get(`/api/user/settings`);
  await cacheSettings(data);
  queryClient.invalidateQueries({ queryKey: ["settings"] });
  return data;
}

export async function syncOutbox({ force = false } = {}) {
  if (!isFullyOnline() && !force) return;
  if (syncing) {
    syncQueued = true;
    return;
  }

  // Fast path: if the outbox is empty, skip everything — nothing to flush,
  // no need to re-fetch (React Query already refreshes independently on
  // mount / focus). This keeps cold starts from issuing redundant GETs.
  const pending = await pendingCount();
  if (pending === 0 && !force) return;

  syncing = true;
  try {
    await flushLibrary();
    await flushVolumes();
    await flushSettings();
    // Only pull fresh server state when we actually pushed something —
    // otherwise the read hooks already have what they need.
    await Promise.all([
      refetchLibrary().catch(() => {}),
      refetchSettings().catch(() => {}),
    ]);
  } catch (err) {
    probeServer().catch(() => {});
    console.warn("[sync] retriable error, will retry later:", err?.message);
  } finally {
    syncing = false;
    if (syncQueued) {
      syncQueued = false;
      setTimeout(syncOutbox, 1000);
    }
  }
}

export function triggerSync() {
  if (isFullyOnline()) syncOutbox();
}

/**
 * Force full re-sync from server: fetch everything fresh and REPLACE local
 * state (library, volumes, settings) + discard any pending outbox ops.
 *
 * Explicit user action — used by "Restore from server" in settings when the
 * user wants to give up local changes and take whatever the server says as
 * truth.
 */
export async function forceResyncFromServer() {
  if (!isFullyOnline()) {
    throw new Error("Server is unreachable — restore requires a connection");
  }

  const [libRes, volRes, settingsRes] = await Promise.all([
    axios.get(`/api/user/library`),
    axios.get(`/api/user/volume`),
    axios.get(`/api/user/settings`),
  ]);

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
      await db.outboxLibrary.clear();
      await db.outboxVolumes.clear();
      await db.outboxSettings.clear();
      await db.library.clear();
      await db.volumes.clear();
      await db.settings.clear();

      if (libRes.data?.length) await db.library.bulkPut(libRes.data);
      if (volRes.data?.length) await db.volumes.bulkPut(volRes.data);
      if (settingsRes.data) {
        await db.settings.put({ key: "user", ...settingsRes.data });
      }
    }
  );

  queryClient.invalidateQueries();
  notifyPendingChanged();
}

/**
 * When the server is reachable again, attempt any pending logout BEFORE
 * running data sync — so a stale session gets invalidated server-side
 * before anything else can refresh the cache.
 */
async function onServerRecover() {
  if (hasPendingLogout()) {
    await flushPendingLogout();
    // Don't sync after a successful logout — outbox was already cleared by
    // logout() locally, and sending requests with an invalidated cookie
    // would just produce 401s.
    return;
  }
  if (isFullyOnline()) syncOutbox();
}

/**
 * Install sync runner.
 *
 * Unlike a naive `online`-event listener, we subscribe to the combined
 * connectivity watcher so a flush happens when EITHER:
 *   - the browser regains connectivity, or
 *   - the server itself comes back up after a crash/deploy.
 */
export function installSyncRunner() {
  onConnectivityChange((e) => {
    if (e.detail?.serverReachable && navigator.onLine) {
      onServerRecover();
    }
  });

  // Slow safety-net for stuck ops: only do real work if there's actually
  // something pending. A bare interval that fires GETs every minute would
  // pile up on top of the React Query refetches and delay initial render.
  setInterval(async () => {
    if (!isFullyOnline()) return;
    if (hasPendingLogout()) {
      flushPendingLogout();
      return;
    }
    const n = await pendingCount();
    if (n > 0) syncOutbox();
  }, 60_000);

  // Deferred startup check — only schedules work if there IS work. Uses
  // requestIdleCallback so it never competes with the initial data render.
  const startup = async () => {
    if (hasPendingLogout()) {
      if (isFullyOnline()) flushPendingLogout();
      return;
    }
    const n = await pendingCount();
    if (n > 0 && isFullyOnline()) syncOutbox();
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(startup, { timeout: 2000 });
  } else {
    setTimeout(startup, 1000);
  }
}
