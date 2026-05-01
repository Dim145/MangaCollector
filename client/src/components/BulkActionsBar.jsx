import { useMemo, useState } from "react";
import { haptics } from "@/lib/haptics.js";
import { sounds } from "@/lib/sounds.js";
import {
  enqueueBulkMark,
  enqueueLibraryDelete,
} from "@/lib/sync.js";
import { useT } from "@/i18n/index.jsx";

/*
 * 一括 · Bulk-actions bottom bar.
 *
 * Surfaces the actions available on a multi-select of library
 * entries. Slides up from the bottom (`animate-fade-up` matches the
 * existing dashboard motion vocabulary) and stays fixed at the
 * viewport edge until the user dismisses (Cancel, ESC, or completes
 * an action).
 *
 * Actions:
 *   - Mark all owned    → enqueueBulkMark({ owned: true })
 *   - Mark all unowned  → enqueueBulkMark({ owned: false })
 *   - Mark all read     → enqueueBulkMark({ read: true })
 *   - Mark all unread   → enqueueBulkMark({ read: false })
 *   - Delete            → enqueueLibraryDelete per series
 *
 * All four actions go through the offline-first outbox: the local
 * Dexie state is mutated optimistically (every released volume row
 * + the library counter) so the UI reflects the change immediately,
 * and the cascade is queued in `outboxBulkMark` for the sync runner
 * to flush when online. Repeat clicks on the same series coalesce —
 * see `enqueueBulkMark` in lib/sync.js for the merge contract.
 */
export default function BulkActionsBar({ library, selectedIds, onClose }) {
  const t = useT();
  const count = selectedIds.size;
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const selectedRows = useMemo(
    () => library.filter((m) => selectedIds.has(m.mal_id)),
    [library, selectedIds],
  );

  if (count === 0) return null;

  // Generic dispatcher: enqueue per-series bulk-mark ops. The
  // optimistic local update inside `enqueueBulkMark` makes the
  // dashboard reflect the change in the same frame, even offline —
  // the network flush is a sync-runner concern.
  const runBulkMark = async ({ owned, read }) => {
    setBusy(true);
    haptics.bump();
    await Promise.allSettled(
      selectedRows.map((row) => enqueueBulkMark(row.mal_id, { owned, read })),
    );
    setBusy(false);
    sounds.success();
    onClose();
  };

  const runDelete = async () => {
    setBusy(true);
    haptics.warning();
    await Promise.allSettled(
      selectedRows.map((row) => enqueueLibraryDelete(row.mal_id)),
    );
    setBusy(false);
    sounds.success();
    onClose();
  };

  return (
    <div
      // Fixed at the viewport bottom; mobile-safe inset (pb-safe
      // accounts for the home indicator). On desktop, the bar floats
      // centered with a max-width so the action chips don't stretch
      // unnaturally.
      className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-3xl px-4 pb-safe sm:bottom-6 sm:px-6"
      role="region"
      aria-label={t("bulk.regionLabel")}
    >
      <div
        className="animate-fade-up rounded-2xl border border-hanko/40 bg-ink-1/95 p-3 shadow-2xl backdrop-blur-xl"
        // Block global shortcuts (g-chord, ?-cheatsheet) while the bar
        // is interactive — the operator is in a focused mode.
        data-shortcut-block
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-hanko/15 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-hanko-bright">
            <span className="font-jp text-[13px] not-uppercase tracking-normal">
              選
            </span>
            {t("bulk.countSelected", { n: count })}
          </span>

          {!confirmingDelete && (
            <>
              <button
                type="button"
                onClick={() => runBulkMark({ owned: true })}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-hanko/40 bg-hanko/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/20 disabled:opacity-50"
              >
                <span className="font-jp text-[12px] not-uppercase">完</span>
                {t("bulk.markOwned")}
              </button>
              <button
                type="button"
                onClick={() => runBulkMark({ owned: false })}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-ink-0/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-washi-muted transition hover:text-washi disabled:opacity-50"
              >
                <span className="font-jp text-[12px] not-uppercase">空</span>
                {t("bulk.markUnowned")}
              </button>
              <button
                type="button"
                onClick={() => runBulkMark({ read: true })}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-moegi/50 bg-moegi/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-moegi transition hover:bg-moegi/20 disabled:opacity-50"
              >
                <span className="font-jp text-[12px] not-uppercase">読</span>
                {t("bulk.markRead")}
              </button>
              <button
                type="button"
                onClick={() => runBulkMark({ read: false })}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-ink-0/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-washi-muted transition hover:text-washi disabled:opacity-50"
              >
                <span className="font-jp text-[12px] not-uppercase">未</span>
                {t("bulk.markUnread")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-hanko/30 bg-hanko/5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/15 disabled:opacity-50"
              >
                <span className="font-jp text-[12px] not-uppercase">削</span>
                {t("bulk.delete")}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="ml-auto inline-flex items-center rounded-full border border-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-washi-dim transition hover:text-washi"
              >
                {t("bulk.cancel")}
              </button>
            </>
          )}

          {confirmingDelete && (
            <div className="flex flex-1 items-center gap-2">
              <span className="flex-1 text-sm text-hanko-bright">
                {t("bulk.deleteConfirm", { n: count })}
              </span>
              <button
                type="button"
                onClick={runDelete}
                disabled={busy}
                className="inline-flex items-center rounded-full bg-hanko px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-washi transition hover:bg-hanko-bright disabled:opacity-50"
              >
                {t("bulk.deleteConfirmYes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="inline-flex items-center rounded-full border border-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-washi-dim transition hover:text-washi"
              >
                {t("bulk.cancel")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
