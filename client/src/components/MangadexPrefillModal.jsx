import { useState } from "react";
import Modal from "@/components/ui/Modal.jsx";
import { useT } from "@/i18n/index.jsx";

/**
 * Shown when the user picks a MangaDex-only result from the search. MangaDex
 * almost never publishes a fixed volume count, so we ask the user to fill
 * one in before creating the library entry. Title / cover / genres are taken
 * straight from the MangaDex result.
 */
export default function MangadexPrefillModal({ result, onClose, onConfirm }) {
  const t = useT();
  const [volumes, setVolumes] = useState(result?.volumes ?? 1);
  const [submitting, setSubmitting] = useState(false);

  if (!result) return null;

  const submit = async () => {
    const n = parseInt(volumes, 10);
    if (!Number.isFinite(n) || n < 0) return;
    setSubmitting(true);
    try {
      await onConfirm({
        mangadex_id: result.mangadex_id,
        name: result.name,
        image_url_jpg: result.image_url ?? null,
        volumes: n,
        volumes_owned: 0,
        genres: result.genres ?? [],
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal popupOpen={Boolean(result)} handleClose={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-ink-1/95 p-6 shadow-2xl backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="rounded-full bg-gold/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-gold">
            MangaDex
          </span>
          <h2 className="font-display text-xl font-semibold italic text-washi">
            {t("mangadexPrefill.title")}
          </h2>
        </div>
        <p className="mt-2 text-xs text-washi-muted">
          {t("mangadexPrefill.subtitle")}
        </p>

        <div className="mt-4 flex gap-3">
          {result.image_url && (
            <img referrerPolicy="no-referrer"
              src={result.image_url}
              alt=""
              className="h-28 w-20 shrink-0 rounded-md border border-border object-cover shadow"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-washi line-clamp-3">
              {result.name}
            </p>
            {result.genres?.length > 0 && (
              <p className="mt-1 line-clamp-2 font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                {result.genres.slice(0, 6).join(" · ")}
              </p>
            )}
          </div>
        </div>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
            {t("mangadexPrefill.volumesLabel")}
          </span>
          <input
            type="number"
            min="0"
            max="999"
            value={volumes}
            onChange={(e) => setVolumes(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-ink-2 px-3 py-2 font-display text-base text-washi focus:border-hanko focus:outline-none"
          />
          <span className="mt-1 block text-[10px] text-washi-dim">
            {t("mangadexPrefill.volumesHint")}
          </span>
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-full border border-border bg-ink-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-washi/30 hover:text-washi disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-full bg-hanko px-5 py-2 text-xs font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-50"
          >
            {submitting ? (
              <span className="inline-flex h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
            ) : (
              t("mangadexPrefill.confirm")
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
