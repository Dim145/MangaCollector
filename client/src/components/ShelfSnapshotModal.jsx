import { useEffect, useRef, useState } from "react";
import Modal from "./ui/Modal.jsx";
import {
  renderShelfSnapshotBlob,
  shareOrDownloadSnapshot,
} from "@/lib/shelfSnapshot.js";
import { haptics } from "@/lib/haptics.js";
import { sounds } from "@/lib/sounds.js";
import { useT, useLang } from "@/i18n/index.jsx";

/*
 * 棚 · Shelf-snapshot modal — preview + share/download actions.
 *
 * On open, the canvas renderer kicks off (it's async because cover
 * images need to load with `crossOrigin="anonymous"` and the fonts
 * have to settle). While that runs we show a tasteful loading panel
 * with the same brushstroke kanji vocabulary as the rest of the app.
 *
 * Once the blob lands we render it as a flat <img> preview (faster
 * + lighter than re-injecting the canvas) and offer two actions:
 *
 *   - Share  — only shown when `navigator.canShare({ files })` is
 *              available. On mobile this opens the OS share sheet.
 *   - Save   — synthetic `<a download>` click. Always available as
 *              the universal fallback.
 *
 * The preview is generated once per open. Re-rendering on every
 * library change inside the modal would burn cycles for nothing —
 * the user opens the modal at a moment in time, sees that snapshot,
 * acts on it. If they want a fresh one, closing + reopening
 * regenerates.
 */
export default function ShelfSnapshotModal({
  open,
  onClose,
  library,
  stats,
  userName,
}) {
  const t = useT();
  const lang = useLang();
  const [previewUrl, setPreviewUrl] = useState(null);
  const [blob, setBlob] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Tracks Web Share API availability so we don't render a Share
  // button on desktop browsers where the call would fail anyway.
  // Cached once at mount because navigator.canShare is sync + cheap.
  const canShareRef = useRef(false);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      try {
        const probe = new File(["x"], "x.png", { type: "image/png" });
        canShareRef.current = Boolean(
          navigator.canShare && navigator.canShare({ files: [probe] }),
        );
      } catch {
        canShareRef.current = false;
      }
    }
  }, []);

  // Generate the snapshot whenever the modal transitions to open.
  // Depending on the library size + cover hosts this can take a
  // beat (~500-1500 ms typical) — mostly the parallel image loads.
  useEffect(() => {
    if (!open) {
      setPreviewUrl(null);
      setBlob(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setBusy(true);
    setError(null);
    (async () => {
      try {
        const out = await renderShelfSnapshotBlob({
          library,
          stats,
          userName,
          locale: lang,
        });
        if (cancelled) return;
        setBlob(out);
        setPreviewUrl(URL.createObjectURL(out));
      } catch (err) {
        if (!cancelled) {
          console.error("[shelf-snapshot] render failed", err);
          setError(err);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Revoke the blob URL on unmount so the browser releases memory.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleShare = async () => {
    if (!blob) return;
    setBusy(true);
    haptics.bump();
    try {
      await shareOrDownloadSnapshot(
        blob,
        `mangacollector-shelf-${Date.now()}.png`,
      );
      sounds.success();
    } catch (err) {
      console.warn("[shelf-snapshot] share failed", err);
      sounds.error();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal popupOpen={open} handleClose={onClose} additionalClasses="w-full max-w-2xl">
      <div className="relative overflow-hidden rounded-2xl border border-washi/15 bg-ink-1/98 shadow-2xl">
        {/* Cream + hanko atmospheric blooms — same vocabulary as
            AddCoffretModal so the snapshot modal feels like part
            of the same family of "deliberate, ceremonious" actions. */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-washi/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-hanko/10 blur-3xl" />

        {/* 棚 watermark — vertical script anchored to the corner.
            Sits at z-0 behind the content. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-12 -right-12 select-none font-jp text-[18rem] font-bold leading-none text-washi/[0.06]"
          style={{ writingMode: "vertical-rl" }}
        >
          棚
        </span>

        <header className="relative border-b border-border/60 px-6 pt-6 pb-5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("snapshot.eyebrow")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h2 className="mt-2 font-display text-2xl font-light italic leading-none tracking-tight text-washi md:text-3xl">
            {t("snapshot.title")}
          </h2>
          <p className="mt-2 max-w-md text-sm text-washi-muted">
            {t("snapshot.byline")}
          </p>
        </header>

        <div className="relative px-6 py-5">
          {/* Preview frame — keeps the 4:5 aspect even while the
              snapshot is rendering, so the modal doesn't reflow
              when the image lands. */}
          <div
            className="relative mx-auto w-full max-w-md overflow-hidden rounded-xl border border-border bg-ink-0/80 shadow-2xl"
            style={{ aspectRatio: "1080 / 1350" }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={t("snapshot.previewAlt")}
                className="h-full w-full object-contain animate-fade-in"
                draggable={false}
              />
            ) : busy ? (
              <div className="absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center gap-3 text-washi-dim">
                  <span className="font-jp text-5xl font-bold text-hanko/60 animate-pulse">
                    棚
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.25em]">
                    {t("snapshot.rendering")}
                  </span>
                </div>
              </div>
            ) : error ? (
              <div className="absolute inset-0 grid place-items-center px-6 text-center">
                <p className="text-sm text-hanko-bright">
                  {t("snapshot.renderError")}
                </p>
              </div>
            ) : null}
          </div>

          <p className="mt-4 text-center text-[11px] text-washi-dim">
            {t("snapshot.helper")}
          </p>
        </div>

        <footer className="relative border-t border-border/60 px-6 py-4">
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border bg-transparent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi hover:border-border/80"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleShare}
              disabled={busy || !blob}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-hanko px-5 py-2 text-xs font-semibold uppercase tracking-wider text-washi shadow-md transition hover:bg-hanko-bright active:scale-95 disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                {/* Universal "share" arrow — chosen icon set is
                    consistent across the app's other actions. */}
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              {canShareRef.current ? t("snapshot.share") : t("snapshot.download")}
            </button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
