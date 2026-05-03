/*
 * Sync barrel — re-exports the public API of the sync sub-system.
 *
 * The implementation lives in three sibling modules under `./sync/`:
 *   - events.js  — pub-sub channels (pending-changed, sync-error, sync-info)
 *   - outbox.js  — Dexie outbox enqueue + flush logic + force-resync
 *   - runner.js  — connectivity-gated background flusher + pending logout
 *
 * Consumers keep importing `@/lib/sync.js`; this file fans out so the
 * named exports stay stable.
 */

export {
  notifyPendingChanged,
  onPendingChanged,
  onSyncError,
  notifySyncError,
  onSyncInfo,
  notifySyncInfo,
} from "./sync/events.js";

export {
  pendingCount,
  enqueueLibraryUpsert,
  enqueueLibraryDelete,
  enqueueLibraryUpdateVolumes,
  enqueueLibraryPatch,
  enqueueLibraryPoster,
  enqueueLibraryVolumesOwned,
  enqueueVolumeUpdate,
  enqueueSettingsUpdate,
  enqueueBulkMark,
  enqueueAuthorUpdate,
  enqueueAuthorDelete,
  enqueueCoffretCreate,
  enqueueCoffretUpdate,
  enqueueCoffretDelete,
  syncOutbox,
  triggerSync,
  forceResyncFromServer,
} from "./sync/outbox.js";

export { installSyncRunner, uninstallSyncRunner } from "./sync/runner.js";
