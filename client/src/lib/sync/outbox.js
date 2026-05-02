import axios from "@/utils/axios.js";
import { cacheLibrary, cacheVolumesForManga, cacheSettings, db } from "../db.js";
import { isFullyOnline, probeServer } from "../connectivity.js";
import { queryClient } from "../queryClient.js";
import { emitSyncError, notifyPendingChanged } from "./events.js";

/*
 * Sync outbox — flushes the Dexie outbox tables to the backend.
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

let syncing = false;
let syncQueued = false;

/** Count all pending ops across outbox tables. */
export async function pendingCount() {
  const [lib, vol, set, bulk, authors] = await Promise.all([
    db.outboxLibrary.count(),
    db.outboxVolumes.count(),
    db.outboxSettings.count(),
    db.outboxBulkMark.count(),
    db.outboxAuthors.count(),
  ]);
  return lib + vol + set + bulk + authors;
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
    db.outboxBulkMark,
    async () => {
      await db.library.delete(mal_id);
      await db.volumes.where("mal_id").equals(mal_id).delete();
      // Discard any pending per-volume + bulk-mark ops — replaying
      // them after the cascade-delete would 404 noisily without
      // changing the outcome (server already wiped the rows).
      await db.outboxVolumes.where("mal_id").equals(mal_id).delete();
      await db.outboxBulkMark.delete(mal_id);
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
  for (const key of ["publisher", "edition", "review"]) {
    if (!(key in fields)) continue;
    const raw = fields[key];
    if (raw == null) {
      next[key] = null;
    } else {
      const trimmed = String(raw).trim();
      next[key] = trimmed === "" ? null : trimmed;
    }
  }
  // 作家 · Author lives in two shapes:
  //   • Outbox payload : free-text string (server resolves to FK)
  //   • Dexie row      : `{ id, mal_id, name }` ref or null
  // The user types text; we ship the text to the server but write a
  // stub ref into Dexie so the optimistic read view (`row.author?.name`)
  // doesn't see a raw string. The full ref (with id + mal_id) lands
  // on the next refetchLibrary, replacing the stub.
  let authorPayload;
  if ("author" in fields) {
    const raw = fields.author;
    if (raw == null) {
      next.author = null;
      authorPayload = null;
    } else {
      const trimmed = String(raw).trim();
      if (trimmed === "") {
        next.author = null;
        authorPayload = null;
      } else {
        next.author = { id: null, mal_id: null, name: trimmed };
        authorPayload = trimmed;
      }
    }
  }
  // 公 · `review_public` is plain boolean — no trim/empty contract.
  // Skip normalisation, just pass through (server treats null as "leave
  // the flag alone" — see UpdateLibraryRequest::review_public).
  if ("review_public" in fields) {
    next.review_public = Boolean(fields.review_public);
  }
  // Genres ride as an array (not a comma-string). Server-side sanitize
  // (trim / dedup / cap) is the authoritative pass; we only do the
  // bare minimum here so the optimistic Dexie write reflects the same
  // shape the server will eventually apply. We normalise `null` to an
  // empty array because the rest of the app reads `manga.genres` as an
  // iterable — keeping a uniform type avoids `?.` everywhere downstream.
  if ("genres" in fields) {
    const raw = fields.genres;
    next.genres = Array.isArray(raw)
      ? raw
          .map((g) => (typeof g === "string" ? g.trim() : ""))
          .filter((g, i, arr) => g.length > 0 && arr.indexOf(g) === i)
      : [];
  }
  if (Object.keys(next).length === 0 && authorPayload === undefined) return;

  // The outbox payload mirrors `next` for every field EXCEPT author —
  // the server takes a free-text string and resolves the FK itself,
  // so we strip the stub object and substitute the text variant.
  const payloadDelta = { ...next };
  if (authorPayload !== undefined) {
    payloadDelta.author = authorPayload;
  }

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
    current.payload = { ...current.payload, ...payloadDelta };
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
  // Translate the `read: boolean` flag from the call site into the
  // `read_at: iso|null` shape Dexie's live-query readers expect; the
  // matching server-side mapping lives in `services/volume.rs`.
  // 預け · `loan` rides through unchanged — the optimistic Dexie row
  // mirrors the loan triplet, the outbox payload carries the raw
  // patch (null = return, { to, due_at } = lend / update).
  const { read, loan, ...rest } = volume;
  const local = { ...rest };
  if (read !== undefined) {
    local.read_at = read ? new Date().toISOString() : null;
  }
  // Reflect the loan mutation onto the local row so live-query
  // consumers (volume drawer, dashboard widget) update without
  // waiting for a refetch.
  if (loan !== undefined) {
    if (loan === null) {
      local.loaned_to = null;
      local.loan_started_at = null;
      local.loan_due_at = null;
    } else if (loan && typeof loan.to === "string") {
      local.loaned_to = loan.to;
      // Don't overwrite an existing started_at — the server uses the
      // same "preserve on edit" rule. We approximate locally by only
      // stamping when there's nothing yet.
      local.loan_due_at = loan.due_at ?? null;
    }
  }

  await db.transaction("rw", db.volumes, db.outboxVolumes, async () => {
    // Merge with whatever's already cached so we never drop columns that
    // the mutation didn't touch (e.g. user edits only `read` — we must
    // keep the existing price/store values intact in the local row).
    const existing = (await db.volumes.get(local.id)) ?? {};
    // Loan stamp-on-first-lend: if local has a borrower set but no
    // loan_started_at yet, mint one now. Mirrors the server's
    // `existing.loan_started_at.is_none()` branch in `set_loan`.
    if (
      loan !== undefined &&
      loan !== null &&
      !existing.loan_started_at
    ) {
      local.loan_started_at = new Date().toISOString();
    }
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
      // `undefined` for `read` / `notes` means "don't touch" — the
      // flusher only sends those fields when they're explicitly set,
      // matching the server's leave-untouched contract.
      read: read !== undefined ? read : prev.read,
      notes: local.notes !== undefined ? local.notes : prev.notes,
      // 預け · `loan` is optional like read/notes. Pass-through;
      // `null` (return) is meaningfully different from `undefined`
      // (don't touch), so use the `in` check rather than truthiness.
      ...(loan !== undefined ? { loan } : "loan" in prev ? { loan: prev.loan } : {}),
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
        sound_enabled: settings.sound_enabled,
        accent_color: settings.accent_color,
        shelf_3d_enabled: settings.shelf_3d_enabled,
      },
      ts: Date.now(),
    });
  });
  notifyPendingChanged();
  triggerSync();
}

/*
 * ─── Author outbox ────────────────────────────────────────────────────────
 *
 * 作家 · Offline-first CRUD for custom authors. The flow:
 *
 *   1. The user opens an AuthorPage offline, hits "Modifier" and
 *      submits the form. `enqueueAuthorUpdate` writes the new
 *      `name` / `about` straight to the Dexie `authors` row so
 *      the live-query consumers re-render with the edit applied.
 *   2. The same call enqueues a single coalesced op into
 *      `outboxAuthors`, keyed by mal_id. A second edit on the
 *      same author replaces the pending payload (no stacking).
 *   3. When connectivity returns, `flushAuthors` walks the queue
 *      and fires PATCH/DELETE per row. Refetch of the affected
 *      detail (and the library, on delete) happens after the
 *      whole queue drains so the SPA reconciles to server truth.
 *
 * Photo upload/delete + create + refresh stay online-only:
 *   - photo paths involve a multipart Blob that doesn't replay
 *     cleanly through a JSON outbox
 *   - create is no longer reachable from the SPA (the AuthorPage
 *     trims the create CTA after the FK refactor — text-typed
 *     authors get auto-created server-side via
 *     `resolve_author_from_text` on the next library PATCH flush)
 *   - refresh is a deliberate Jikan round-trip with no offline
 *     analogue
 *
 * Conflict semantics: a PATCH then DELETE on the same author
 * collapses to DELETE (the latest op wins via the put-by-key
 * coalesce). A DELETE then PATCH stays a PATCH but will fail
 * server-side (404) — the post-flush error path emits a syncError
 * and re-fetches the author detail to reconcile.
 */

export async function enqueueAuthorUpdate({ mal_id, name, about }) {
  if (mal_id == null) return;
  await db.transaction("rw", db.authors, db.outboxAuthors, async () => {
    const existing = (await db.authors.get(mal_id)) ?? {};
    const next = { ...existing, mal_id };
    if (name !== undefined) next.name = String(name).trim();
    if (about !== undefined) {
      const trimmed = about == null ? null : String(about).trim();
      next.about = trimmed && trimmed.length > 0 ? trimmed : null;
    }
    next.ts = Date.now();
    await db.authors.put(next);

    const pending = await db.outboxAuthors.get(mal_id);
    // If the previous op was a delete, the current edit
    // implicitly cancels the delete (the user clicked "edit"
    // BEFORE the delete had a chance to flush — they changed
    // their mind). Replace with a fresh patch op.
    const prevPayload =
      pending?.op === "patch" ? (pending.payload ?? {}) : {};
    const mergedPayload = {
      ...prevPayload,
      ...(name !== undefined ? { name: next.name } : {}),
      ...(about !== undefined ? { about: next.about } : {}),
    };
    await db.outboxAuthors.put({
      mal_id,
      op: "patch",
      payload: mergedPayload,
      ts: Date.now(),
    });
  });
  notifyPendingChanged();
  triggerSync();
}

export async function enqueueAuthorDelete(mal_id) {
  if (mal_id == null) return;
  await db.transaction("rw", db.authors, db.outboxAuthors, async () => {
    await db.authors.delete(mal_id);
    // Whatever was queued before (patch or delete) is wholly
    // superseded — a delete is terminal.
    await db.outboxAuthors.put({
      mal_id,
      op: "delete",
      payload: null,
      ts: Date.now(),
    });
  });
  notifyPendingChanged();
  triggerSync();
}

/*
 * ─── Bulk operations outbox ───────────────────────────────────────────────
 *
 * 一括 · `enqueueBulkMark` is the offline-first entry point for the
 * dashboard's bulk-actions bar. Each call:
 *   1. Writes the desired state to Dexie OPTIMISTICALLY — every
 *      released volume row of the series is patched, and the
 *      library counter is recomputed. The UI reflects the change
 *      immediately, even offline.
 *   2. Coalesces into `outboxBulkMark` (PK on mal_id) so multiple
 *      rapid clicks on the same series produce a single pending op
 *      with the latest desired state.
 *
 * `flushBulkMark` POSTs the cascade to the server when online,
 * which lets the backend re-apply the same logic authoritatively
 * (and emits the SERIES_COMPLETED activity / volume-milestone seal
 * checks that only fire server-side). On rejection, the local
 * library + volume rows are refetched so the optimistic state
 * snaps back to the server's truth.
 *
 * Upcoming volumes (`release_date` > now) are intentionally
 * excluded both client-side and server-side — they're announced-
 * but-not-shipped tomes, and bulk ops shouldn't break their
 * ownership invariants.
 */
async function applyBulkMarkLocal(mal_id, { owned, read }) {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const volumes = await db.volumes.where("mal_id").equals(mal_id).toArray();
  let ownedCount = 0;
  const updates = [];
  for (const vol of volumes) {
    const releaseMs = vol.release_date
      ? new Date(vol.release_date).getTime()
      : null;
    const isUpcoming = releaseMs != null && releaseMs > nowMs;
    if (isUpcoming) {
      // Untouched — but still counts toward `volumes_owned` if it
      // was already owned (vanishingly rare, but accurate).
      if (vol.owned) ownedCount++;
      continue;
    }
    const next = { ...vol };
    if (typeof owned === "boolean") next.owned = owned;
    if (typeof read === "boolean") next.read_at = read ? nowIso : null;
    updates.push(next);
    if (next.owned) ownedCount++;
  }
  if (updates.length > 0) await db.volumes.bulkPut(updates);
  if (typeof owned === "boolean") {
    const lib = await db.library.get(mal_id);
    if (lib) await db.library.put({ ...lib, volumes_owned: ownedCount });
  }
}

export async function enqueueBulkMark(mal_id, { owned, read }) {
  if (typeof owned !== "boolean" && typeof read !== "boolean") return;
  await db.transaction(
    "rw",
    db.library,
    db.volumes,
    db.outboxBulkMark,
    async () => {
      await applyBulkMarkLocal(mal_id, { owned, read });
      // Coalesce: merge with any pending op for the same series so
      // a "mark owned" followed by "mark read" produces a single
      // op carrying both fields. A repeat for the same field
      // (e.g. owned: true then owned: false) replaces — the latest
      // intent wins.
      const existing = await db.outboxBulkMark.get(mal_id);
      const merged = {
        mal_id,
        owned: typeof owned === "boolean" ? owned : existing?.owned,
        read: typeof read === "boolean" ? read : existing?.read,
        ts: Date.now(),
      };
      await db.outboxBulkMark.put(merged);
    },
  );
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
        if ("review" in (op.payload ?? {})) meta.review = op.payload.review;
        if ("review_public" in (op.payload ?? {})) {
          meta.review_public = op.payload.review_public;
        }
        if ("author" in (op.payload ?? {})) meta.author = op.payload.author;
        // Genres ship as an array; server gates the write to custom-only
        // rows (mal_id < 0 AND mangadex_id IS NULL) and silently drops
        // the field on any other row. The frontend already only opens
        // the editor on those rows, so a non-custom row reaching this
        // branch indicates a stale Dexie payload — harmless to send.
        if ("genres" in (op.payload ?? {})) meta.genres = op.payload.genres;
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
        emitSyncError({
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
        // `read` and `notes` are only sent when explicitly set; an
        // unrelated outbox replay (e.g. a price edit) leaves them
        // untouched server-side.
        ...(op.payload.read !== undefined
          ? { read: Boolean(op.payload.read) }
          : {}),
        ...(op.payload.notes !== undefined
          ? { notes: String(op.payload.notes ?? "") }
          : {}),
        // 預け · Loan mutation. Three-state in the payload mirrors
        // the server's `Option<Option<LoanPatch>>`:
        //   - omitted → leave loan triplet alone
        //   - null → return the volume (clear loan)
        //   - { to, due_at } → mark as lent
        ...("loan" in (op.payload ?? {})
          ? { loan: op.payload.loan }
          : {}),
      });
      await db.outboxVolumes.delete(op.id);
      notifyPendingChanged();
    } catch (err) {
      if (isUnretriable(err)) {
        await db.outboxVolumes.delete(op.id);
        if (op.mal_id) await refetchVolumes(op.mal_id).catch(() => {});
        emitSyncError({
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
        emitSyncError({
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

/**
 * 作家 · Replay queued author CRUD ops. Each op is one of:
 *   • "patch"  → PATCH /api/authors/{mal_id} { name?, about? }
 *   • "delete" → DELETE /api/authors/{mal_id}
 *
 * On success, the local cache is reconciled with the server's
 * response (PATCH echoes the row; DELETE drops it). On unretriable
 * errors (4xx) the op is discarded + a syncError surfaces so the
 * UI can prompt the user to retry. The library is invalidated
 * after a delete since unlinking touches user_libraries.author_id.
 */
async function flushAuthors() {
  const ops = await db.outboxAuthors.orderBy("ts").toArray();
  let touchedDelete = false;
  for (const op of ops) {
    try {
      if (op.op === "patch") {
        const { data } = await axios.patch(
          `/api/authors/${op.mal_id}`,
          op.payload ?? {},
        );
        await db.outboxAuthors.delete(op.mal_id);
        // Server echoes the updated AuthorDetail — reconcile cache.
        if (data && data.mal_id != null) {
          await db.authors.put({ ...data, ts: Date.now() });
        }
        queryClient.setQueryData(["author", op.mal_id], data);
      } else if (op.op === "delete") {
        await axios.delete(`/api/authors/${op.mal_id}`);
        await db.outboxAuthors.delete(op.mal_id);
        await db.authors.delete(op.mal_id);
        queryClient.removeQueries({ queryKey: ["author", op.mal_id] });
        touchedDelete = true;
      } else {
        // Unknown op shape — drop to avoid blocking the queue.
        await db.outboxAuthors.delete(op.mal_id);
      }
      notifyPendingChanged();
    } catch (err) {
      if (isUnretriable(err)) {
        await db.outboxAuthors.delete(op.mal_id);
        emitSyncError({
          op: "author",
          mal_id: op.mal_id,
          message:
            err?.response?.data?.error ?? err.message ?? "Sync failed",
        });
        // Pull the canonical row back so the SPA reconciles to
        // server truth (and the optimistic edit visually unwinds).
        try {
          const { data } = await axios.get(`/api/authors/${op.mal_id}`);
          if (data && data.mal_id != null) {
            await db.authors.put({ ...data, ts: Date.now() });
            queryClient.setQueryData(["author", op.mal_id], data);
          }
        } catch {
          /* fetch reconcile is best-effort */
        }
        notifyPendingChanged();
      } else {
        throw err;
      }
    }
  }
  // After a delete drains, the library has unlinked rows — refetch
  // so embedded `author` refs disappear from the SPA without
  // waiting for the user to navigate. Skip the refetch when no
  // delete happened (a pure patch flush leaves library untouched).
  if (touchedDelete) {
    await refetchLibrary().catch(() => {});
  }
}

async function flushBulkMark() {
  // 一括 · Replays pending bulk-mark cascades. The order is
  // chronological by `ts` so two ops on different series apply in
  // the same order the user produced them. After each successful
  // POST we refetch volumes for that series — the server's cascade
  // is the authoritative source for `read_at` timestamps + the
  // SERIES_COMPLETED activity record, which the optimistic local
  // path can't reproduce exactly.
  const ops = await db.outboxBulkMark.orderBy("ts").toArray();
  for (const op of ops) {
    try {
      const body = {};
      if (typeof op.owned === "boolean") body.owned = op.owned;
      if (typeof op.read === "boolean") body.read = op.read;
      if (Object.keys(body).length === 0) {
        // Nothing meaningful to send (defensive — coalescing should
        // never produce a no-op, but a corrupted Dexie row could).
        await db.outboxBulkMark.delete(op.mal_id);
        continue;
      }
      await axios.post(
        `/api/user/library/${op.mal_id}/volumes/bulk-mark`,
        body,
      );
      await db.outboxBulkMark.delete(op.mal_id);
      await refetchVolumes(op.mal_id).catch(() => {});
      await refetchLibrary().catch(() => {});
      notifyPendingChanged();
    } catch (err) {
      if (isUnretriable(err)) {
        await db.outboxBulkMark.delete(op.mal_id);
        // Server rejected the cascade — pull the authoritative
        // state so the optimistic local diff snaps back.
        await refetchVolumes(op.mal_id).catch(() => {});
        await refetchLibrary().catch(() => {});
        emitSyncError({
          op: "bulk-mark",
          mal_id: op.mal_id,
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
    await flushBulkMark();
    // 作家 · Authors flush AFTER library — a deleted author needs
    // the library refetch to reconcile unlinked rows, and that
    // refetch is what we trigger anyway right below. Order also
    // means a library PATCH carrying free-text author + a
    // subsequent direct author edit on the same person both land
    // in the right order: library PATCH creates the author via
    // `resolve_author_from_text`, then the author PATCH updates it.
    await flushAuthors();
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
      db.outboxBulkMark,
      db.streak,
    ],
    async () => {
      await db.outboxLibrary.clear();
      await db.outboxVolumes.clear();
      await db.outboxSettings.clear();
      await db.outboxBulkMark.clear();
      await db.library.clear();
      await db.volumes.clear();
      await db.settings.clear();
      // 連 · Wipe the cached streak too — a "force resync" implies
      // the local mirror is suspect. The server-derived chip will
      // re-populate from `useStreak` on the next mount.
      await db.streak.clear();

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
