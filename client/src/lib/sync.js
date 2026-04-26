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
// 報 · Positive-confirmation channel. Used for sync results that are
// informational rather than failures — successful refresh-upcoming
// reports, future "added N volumes" / "ISBN backfill done" surfacing.
// Kept separate from the error channel so subscribers can render
// each with its own visual variant (red ink for errors, green-tea
// ink for confirmations) instead of one toaster trying to convey
// both with the same shell.
const SYNC_INFO_EVENT = "mc:sync-info";

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

/**
 * Surface an arbitrary error through the SyncToaster. Useful for
 * direct (non-outbox) mutations — poster upload/remove, MAL refresh,
 * MangaDex refresh, delete-manga — that previously logged to console
 * with no UI feedback, leaving the user believing their action had
 * succeeded.
 *
 * Accepts a string, an Error, or an axios-style error-with-response;
 * the helper unwraps the most informative message available. The
 * resulting toast uses the same shell as outbox-flush errors, so the
 * user experience is consistent.
 */
export function notifySyncError(errOrMessage, opContext = "direct") {
  const message =
    typeof errOrMessage === "string"
      ? errOrMessage
      : (errOrMessage?.response?.data?.error ??
        errOrMessage?.message ??
        "Request failed");
  emit(SYNC_ERROR_EVENT, { op: opContext, message });
}

export function onSyncInfo(handler) {
  window.addEventListener(SYNC_INFO_EVENT, handler);
  return () => window.removeEventListener(SYNC_INFO_EVENT, handler);
}

/**
 * Surface a successful, info-shaped result through the SyncToaster.
 * Caller passes a structured payload the toaster knows how to render:
 *
 *   {
 *     op:     "upcoming-refresh" | "mal-refresh" | …,
 *     tone:   "success" | "neutral",   // success = green-tea accent,
 *                                      // neutral = washi (e.g. "no
 *                                      // changes"); defaults to success
 *     icon:   string,                  // single glyph (kanji / symbol)
 *                                      // shown in the badge slot
 *     title:  string,
 *     body?:  string,                  // optional secondary line
 *   }
 *
 * The toast renders for ~5 s then auto-dismisses. Kept event-driven
 * (rather than imperative `pushToast(...)`) so any future replicator
 * can subscribe alongside SyncToaster without coupling.
 */
export function notifySyncInfo(payload) {
  emit(SYNC_INFO_EVENT, payload || {});
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
    },
  );
  notifyPendingChanged();
  triggerSync();
}

export async function enqueueLibraryUpdateVolumes(mal_id, volumes) {
  await enqueueLibraryPatch(mal_id, { volumes });
}

/**
 * Generic optimistic library-row patch — mirrors any subset of fields
 * (`volumes`, `publisher`, `edition`, `image_url_jpg`) into Dexie and
 * queues a single coalesced outbox op for the same mal_id. The flush
 * handler walks the payload and fires one HTTP request per server
 * endpoint that knows the field.
 *
 * Any string field is normalised:
 *   - leading/trailing whitespace stripped
 *   - empty string after trim → `null` (the "clear this column" intent)
 * Length clamping is the server's job; we don't echo the cap here so
 * the two stay in sync via a single source of truth.
 */
export async function enqueueLibraryPatch(mal_id, fields) {
  // Normalise text fields once. `volumes` and `image_url_jpg` ride
  // through unchanged.
  const next = {};
  if ("volumes" in fields) next.volumes = fields.volumes;
  if ("image_url_jpg" in fields) next.image_url_jpg = fields.image_url_jpg;
  for (const key of ["publisher", "edition"]) {
    if (!(key in fields)) continue;
    const raw = fields[key];
    if (raw == null) {
      next[key] = null;
    } else {
      const trimmed = String(raw).trim();
      next[key] = trimmed === "" ? null : trimmed;
    }
  }
  if (Object.keys(next).length === 0) return;

  await db.transaction("rw", db.library, db.outboxLibrary, async () => {
    const existing = await db.library.get(mal_id);
    if (existing) {
      await db.library.put({ ...existing, ...next });
    }
    const current = (await db.outboxLibrary.get(mal_id)) ?? {
      mal_id,
      op: "patch",
      payload: {},
      ts: Date.now(),
    };
    current.payload = { ...current.payload, ...next };
    // Preserve an in-flight `upsert` op (the row is being created),
    // otherwise this becomes a `patch` op so the flush handler treats
    // each field independently.
    current.op = current.op === "upsert" ? "upsert" : "patch";
    current.ts = Date.now();
    await db.outboxLibrary.put(current);
  });
  notifyPendingChanged();
  triggerSync();
}

/**
 * Optimistic poster change — picker confirm flow. Offline-first: writes the
 * new URL to Dexie immediately (the UI reacts via useLiveQuery) and queues
 * the PATCH for when the server is reachable.
 *
 * Merges with any pending op for the same mal_id:
 *   - delete pending    → bail (the user is about to wipe the series)
 *   - upsert pending    → update the upsert payload's image_url_jpg
 *   - patch / owned     → enrich the existing payload with image_url_jpg
 *   - nothing pending   → new `patch` op carrying only image_url_jpg
 */
export async function enqueueLibraryPoster(mal_id, url) {
  await db.transaction("rw", db.library, db.outboxLibrary, async () => {
    const existing = await db.library.get(mal_id);
    if (existing) {
      await db.library.put({ ...existing, image_url_jpg: url });
    }
    const current = await db.outboxLibrary.get(mal_id);
    if (current?.op === "delete") return;
    if (current?.op === "upsert") {
      await db.outboxLibrary.put({
        ...current,
        payload: { ...current.payload, image_url_jpg: url },
        ts: Date.now(),
      });
      return;
    }
    // owned / patch / none — all routed through a patch-style op so the
    // flush handler can fire the /poster PATCH alongside any existing
    // volume / owned changes queued for the same mal_id.
    const next = current ?? { mal_id, op: "patch", payload: {}, ts: Date.now() };
    await db.outboxLibrary.put({
      ...next,
      op: next.op === "owned" ? "owned" : "patch",
      payload: { ...(next.payload ?? {}), image_url_jpg: url },
      ts: Date.now(),
    });
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
  // Translate the `read: boolean` flag (from the mutation call-site) into
  // a `read_at: iso|null` that matches the server row shape, so Dexie's
  // live-query readers see the optimistic badge update immediately. The
  // server mapping is mirrored in `services/volume.rs::update_by_id`.
  //
  // 記 · The personal note ALSO carries through unchanged — the server
  // column is `notes`, the local Dexie row column is `notes`, the PATCH
  // field is `notes`. No translation needed here, only forwarding.
  const { read, ...rest } = volume;
  const local = { ...rest };
  if (read !== undefined) {
    local.read_at = read ? new Date().toISOString() : null;
  }

  await db.transaction("rw", db.volumes, db.outboxVolumes, async () => {
    // Merge with whatever's already cached so we never drop columns that
    // the mutation didn't touch (e.g. user edits only `read` — we must
    // keep the existing price/store values intact in the local row).
    const existing = (await db.volumes.get(local.id)) ?? {};
    await db.volumes.put({ ...existing, ...local });

    // Merge with any already-pending outbox op for this volume. The
    // previous `put` overwrote the pending payload, so a fast sequence
    // like "toggle read" then "toggle owned" (before the flusher fires)
    // would lose the `read` flag: the second put's `read: undefined`
    // clobbered the first put's `read: true`.
    //
    // Merge semantics:
    //   • Fields the new call did NOT specify (undefined) fall back to
    //     whatever the previous pending payload had — preserving it.
    //   • Fields the new call DID specify take precedence.
    //   • `read: undefined` stays undefined in the merged payload →
    //     flush-step omits the field on the PATCH, which means "leave
    //     unchanged" server-side, consistent with the documented
    //     volume.rs contract.
    const pending = await db.outboxVolumes.get(local.id);
    const prev = pending?.payload ?? {};
    const mergedPayload = {
      owned: local.owned !== undefined ? local.owned : prev.owned,
      price:
        local.price !== undefined ? Number(local.price) || 0 : prev.price,
      store: local.store !== undefined ? (local.store ?? "") : prev.store,
      collector:
        local.collector !== undefined
          ? Boolean(local.collector)
          : prev.collector,
      // `read` is the boolean the flusher translates into the PATCH
      // field. `undefined` means "don't touch" — keep the prior value.
      read: read !== undefined ? read : prev.read,
      // 記 · Personal note. `undefined` means "this PATCH did not touch
      // the note" — same don't-touch policy as `read`. The flusher only
      // forwards a `notes` field on the wire when it's not undefined.
      notes: local.notes !== undefined ? local.notes : prev.notes,
    };

    await db.outboxVolumes.put({
      id: local.id,
      mal_id: local.mal_id,
      op: "update",
      payload: mergedPayload,
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
        // Server auto-creates N volume rows on insert — pull them into Dexie
        // so the MangaPage grid paints them without a manual refresh.
        await refetchVolumes(op.mal_id).catch(() => {});
      } else if (op.op === "owned") {
        const n = op.payload.volumes_owned;
        await axios.patch(`/api/user/library/${op.mal_id}/${n}`);
        // Poster changes can ride along — the owned PATCH doesn't accept a
        // cover URL so we fire a dedicated /poster PATCH afterwards.
        if (op.payload?.image_url_jpg) {
          await axios.patch(`/api/user/storage/poster/${op.mal_id}`, {
            url: op.payload.image_url_jpg,
          });
        }
      } else if (op.op === "patch") {
        // A "patch" op is a bag of pending field updates. We split the
        // payload across two endpoints because the server keeps poster
        // changes on a dedicated route. Library-row metadata
        // (volumes / publisher / edition) all goes through one request
        // so a multi-field edit only burns one round trip.
        const meta = {};
        if (op.payload?.volumes != null) meta.volumes = op.payload.volumes;
        if ("publisher" in (op.payload ?? {})) meta.publisher = op.payload.publisher;
        if ("edition" in (op.payload ?? {})) meta.edition = op.payload.edition;
        if (Object.keys(meta).length > 0) {
          await axios.patch(`/api/user/library/${op.mal_id}`, meta);
          // A volumes change rebuilds rows in user_volumes server-side;
          // refetch so the new rows surface in Dexie. Skip when only
          // metadata changed — no volume table mutation involved.
          if (meta.volumes != null) {
            await refetchVolumes(op.mal_id).catch(() => {});
          }
        }
        if (op.payload?.image_url_jpg) {
          await axios.patch(`/api/user/storage/poster/${op.mal_id}`, {
            url: op.payload.image_url_jpg,
          });
        }
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
        collector: Boolean(op.payload.collector),
        // Only forward the `read` flag when it was explicitly set —
        // sending undefined leaves the server-side read_at untouched.
        ...(op.payload.read !== undefined
          ? { read: Boolean(op.payload.read) }
          : {}),
        // 記 · Same don't-touch contract as `read`: omit the field when
        // the merged payload didn't carry an explicit edit so unrelated
        // outbox replays (e.g. a price-only change) can't accidentally
        // clear or rewrite the note.
        ...(op.payload.notes !== undefined
          ? { notes: String(op.payload.notes ?? "") }
          : {}),
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
    },
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

// Module-level singleton guard: ensures we only subscribe to
// connectivity once and only start one interval, no matter how many
// times `installSyncRunner()` is called. React StrictMode
// double-invokes every effect in dev, so without this sentinel we'd
// end up with two connectivity listeners + two intervals firing in
// parallel — benign functionally but confusing in logs and a source
// of flaky test runs.
let _syncRunnerInstalled = false;
let _syncRunnerInterval = null;
let _syncRunnerUnsubscribe = null;

/**
 * Install sync runner.
 *
 * Unlike a naive `online`-event listener, we subscribe to the combined
 * connectivity watcher so a flush happens when EITHER:
 *   - the browser regains connectivity, or
 *   - the server itself comes back up after a crash/deploy.
 *
 * Returns a teardown function so callers (e.g. the React mount-effect
 * in `App.jsx`) can cleanly undo the install during hot-reload or
 * StrictMode's synthetic second mount.
 */
export function installSyncRunner() {
  if (_syncRunnerInstalled) return uninstallSyncRunner;
  _syncRunnerInstalled = true;

  _syncRunnerUnsubscribe = onConnectivityChange((e) => {
    if (e.detail?.serverReachable && navigator.onLine) {
      onServerRecover();
    }
  });

  // Slow safety-net for stuck ops: only do real work if there's actually
  // something pending. A bare interval that fires GETs every minute would
  // pile up on top of the React Query refetches and delay initial render.
  _syncRunnerInterval = setInterval(async () => {
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

  return uninstallSyncRunner;
}

/** Undo `installSyncRunner` — exposed for tests + StrictMode cleanup. */
export function uninstallSyncRunner() {
  if (_syncRunnerInterval) {
    clearInterval(_syncRunnerInterval);
    _syncRunnerInterval = null;
  }
  if (typeof _syncRunnerUnsubscribe === "function") {
    _syncRunnerUnsubscribe();
    _syncRunnerUnsubscribe = null;
  }
  _syncRunnerInstalled = false;
}
