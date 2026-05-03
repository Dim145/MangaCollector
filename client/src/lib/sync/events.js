/*
 * Sync events — pub-sub plumbing for the three channels the SyncToaster
 * (and other subscribers) listen on:
 *   - PENDING_CHANGED: outbox row count moved (badge animation, status pill)
 *   - SYNC_ERROR:      a flush op rejected with a 4xx, or a direct mutation
 *                      surfaced an error via `notifySyncError`
 *   - SYNC_INFO:       a positive-confirmation result worth toasting
 *                      (refresh-upcoming summary, bulk-edit success)
 *
 * Kept dependency-free so the outbox + runner modules can both `import`
 * from here without creating a cycle.
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
// 同期 · Realtime push relay. Fires every time `useRealtimeSync`
// receives a server-pushed `SyncEvent` over the websocket. Used by
// downstream components that want to react to specific kinds
// without re-implementing the websocket plumbing or coupling to
// React Query invalidation paths. The detail shape mirrors the
// server-side `SyncEvent`: `{ user_id, kind, payload? }`.
const SYNC_EVENT = "mc:sync-event";

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Internal helper used by outbox flush handlers to emit a structured
 * sync-error payload. Kept named (not `emit(SYNC_ERROR_EVENT, ...)`)
 * so the constant stays private to this module.
 */
export function emitSyncError(detail) {
  emit(SYNC_ERROR_EVENT, detail);
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

/** Re-emit a server-pushed SyncEvent for downstream subscribers. */
export function emitSyncEvent(detail) {
  emit(SYNC_EVENT, detail || {});
}

/** Subscribe to every realtime SyncEvent. Returns an unsubscribe fn. */
export function onSyncEvent(handler) {
  window.addEventListener(SYNC_EVENT, handler);
  return () => window.removeEventListener(SYNC_EVENT, handler);
}
