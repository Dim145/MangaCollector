import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import Modal from "./ui/Modal.jsx";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useUserSettings } from "@/hooks/useSettings.js";
import {
  useCreateSnapshot,
  useDeleteSnapshot,
  useSnapshots,
  useUploadSnapshotImage,
} from "@/hooks/useSnapshots.js";
import { useT, useLang } from "@/i18n/index.jsx";
import { renderShelfSnapshotBlob } from "@/lib/shelfSnapshot.js";

/**
 * 印影 Inei · Snapshot history gallery.
 *
 * Aesthetic — a photographer's contact sheet laid out on dark felt.
 * Each captured snapshot is a developed photographic plate with a
 * gold-leaf scratched corner, a hanko date stamp pressed into the
 * margin, and the title inscribed in italic display below. The
 * grid alternates per-card rotation (-1° / +0.6°) so the gallery
 * reads as hand-pinned to a corkboard rather than aligned to a
 * spreadsheet. Hover lifts the plate slightly and reveals a delete
 * pill in the top-right corner.
 *
 * The capture flow is a single CTA at the top — clicking opens a
 * narrow modal that asks for a name + optional notes, then renders
 * the shelf via `shelfSnapshot.js`, creates the row, and uploads
 * the PNG. All three steps run sequentially because the row id is
 * needed for the upload path.
 */
export default function SnapshotsPage() {
  const t = useT();
  const lang = useLang();
  const { data: snapshots = [], isLoading } = useSnapshots();
  const { data: library } = useLibrary();
  const { data: settings } = useUserSettings();

  const [captureOpen, setCaptureOpen] = useState(false);
  const [detail, setDetail] = useState(null); // viewing fullsize

  // Sort newest first to match the server's ordering. The query
  // already returns this order, but a freshly captured row from
  // setQueryData may land at the front before this resolves; we
  // re-sort defensively so the UI reads in the expected direction.
  const sorted = useMemo(
    () =>
      [...(snapshots ?? [])].sort(
        (a, b) =>
          new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime(),
      ),
    [snapshots],
  );

  const userName =
    settings?.title_type ?? settings?.display_name ?? t("snapshots.archivist");

  return (
    <DefaultBackground>
      <div className="relative mx-auto max-w-6xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* ── Atmosphere ── two darkroom-glow orbs offset diagonally
            so the page reads as a developed contact sheet under
            warm lamp light. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-40 -z-10 h-96 w-96 rounded-full bg-gold/10 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 top-72 -z-10 h-80 w-80 rounded-full bg-hanko/10 blur-3xl"
        />
        <CornerKanji />

        <Hero
          count={sorted.length}
          onCapture={() => setCaptureOpen(true)}
          t={t}
          lang={lang}
        />

        {isLoading && sorted.length === 0 ? (
          <LoadingPanel t={t} />
        ) : sorted.length === 0 ? (
          <EmptyPanel onCapture={() => setCaptureOpen(true)} t={t} />
        ) : (
          <PlatesGrid
            snapshots={sorted}
            onView={setDetail}
            t={t}
            lang={lang}
          />
        )}

        <footer className="mt-12 text-center md:mt-16">
          <Link
            to="/dashboard"
            className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim transition hover:text-washi"
          >
            <span className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            {t("snapshots.backToDashboard")}
          </Link>
        </footer>

        {captureOpen && (
          <CaptureModal
            library={library ?? []}
            userName={userName}
            lang={lang}
            onClose={() => setCaptureOpen(false)}
            t={t}
          />
        )}

        {detail && (
          <DetailModal
            snapshot={detail}
            onClose={() => setDetail(null)}
            lang={lang}
            t={t}
          />
        )}
      </div>
    </DefaultBackground>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────

function Hero({ count, onCapture, t }) {
  return (
    <header className="relative mb-12 animate-fade-up md:mb-16">
      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
          {t("snapshots.kicker")}
        </span>
        <span className="font-jp text-[11px] tracking-[0.4em] text-hanko/80">
          印影
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent" />
        <span className="font-mono text-[11px] tabular-nums uppercase tracking-[0.22em] text-washi-dim">
          {count} {count === 1 ? t("snapshots.unitSingular") : t("snapshots.unitPlural")}
        </span>
      </div>

      <div className="flex flex-col items-start gap-6 md:flex-row md:items-end md:justify-between md:gap-12">
        <div className="min-w-0">
          <h1 className="font-display text-5xl font-light italic leading-[0.95] tracking-tight text-washi md:text-6xl lg:text-7xl">
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("snapshots.title")}
            </span>
          </h1>
          <p className="mt-4 max-w-lg font-display text-lg font-light italic leading-snug text-washi-muted md:text-xl">
            {t("snapshots.subtitle")}
          </p>
        </div>

        {/* Capture CTA — frame as a shutter-release button. The
            inner kanji 印 reads as the seal pressed at exposure. */}
        <button
          type="button"
          onClick={onCapture}
          className="group inline-flex shrink-0 items-center gap-3 rounded-full border border-gold/55 bg-gold/8 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-gold transition hover:border-gold hover:bg-gold/15"
        >
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-full bg-gold/20 font-jp text-sm not-italic text-gold transition group-hover:rotate-[8deg]"
          >
            印
          </span>
          {t("snapshots.captureCta")}
        </button>
      </div>
    </header>
  );
}

// ─── Grid ──────────────────────────────────────────────────────────

function PlatesGrid({ snapshots, onView, t, lang }) {
  return (
    <ul className="grid gap-6 sm:grid-cols-2 sm:gap-7 lg:grid-cols-3 lg:gap-8">
      {snapshots.map((s, i) => (
        <li
          key={s.id}
          className="animate-fade-up"
          style={{ animationDelay: `${120 + i * 70}ms` }}
        >
          <Plate snapshot={s} index={i} onView={() => onView(s)} t={t} lang={lang} />
        </li>
      ))}
    </ul>
  );
}

function Plate({ snapshot, index, onView, t, lang }) {
  const restTilt = index % 3 === 0 ? "-0.9deg" : index % 3 === 1 ? "0.6deg" : "-0.4deg";
  const dateLabel = formatDate(snapshot.taken_at, lang);
  const completion =
    snapshot.total_volumes > 0
      ? Math.round((snapshot.total_owned / snapshot.total_volumes) * 100)
      : 0;
  const imgUrl = snapshot.has_image
    ? `/api/user/snapshots/${snapshot.id}/image`
    : null;

  return (
    <button
      type="button"
      onClick={onView}
      className="inei-plate group relative block w-full overflow-hidden rounded-md border border-border/80 bg-ink-1/40 text-left shadow-[0_18px_40px_-22px_rgba(0,0,0,0.85)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-gold/40 hover:shadow-[0_26px_50px_-22px_rgba(201,169,97,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
      style={{ transform: `rotate(${restTilt})` }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "rotate(0deg) translateY(-4px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = `rotate(${restTilt})`;
      }}
      aria-label={t("snapshots.openAria", { name: snapshot.name })}
    >
      {/* Photographic plate — 4:5 aspect ratio matches the actual
          PNG output of `shelfSnapshot.js` so the thumbnail feels
          authentic, not a cropped detail. */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-ink-2 to-ink-3">
        {imgUrl ? (
          <img
            src={imgUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-7xl italic text-hanko/40">
            印
          </div>
        )}

        {/* Gold-leaf torn corner — top-left. Subtle gradient that
            mimics the lifted edge of a print left in a darkroom too
            long. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-10 w-10 bg-gradient-to-br from-gold/30 via-gold/10 to-transparent"
          style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}
        />

        {/* Inscribed date band — top-right. Hanko-red ink stamp. */}
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-sm bg-hanko/85 px-2 py-1 font-mono text-[10px] tabular-nums uppercase tracking-[0.18em] text-washi shadow"
          style={{ transform: "rotate(-2deg)" }}
        >
          <span className="font-jp not-italic">日</span>
          {dateLabel}
        </span>

        {/* Bottom gradient — bleeds the photograph into the metadata
            band below for a soft transition. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink-1/95 via-ink-1/70 to-transparent"
        />
      </div>

      {/* Inscribed footer — title + stats triad */}
      <div className="px-4 pt-3 pb-4">
        <h3 className="line-clamp-1 font-display text-base font-semibold italic text-washi">
          {snapshot.name}
        </h3>
        {snapshot.notes && (
          <p className="mt-1 line-clamp-1 font-display text-[12px] italic text-washi-muted">
            {snapshot.notes}
          </p>
        )}
        <div className="mt-3 flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-washi-dim">
          <span>
            <span className="tabular-nums text-washi">{snapshot.total_owned}</span>
            <span className="text-washi-dim">/{snapshot.total_volumes}</span>
            <span className="ml-1">{t("snapshots.statVolumes")}</span>
          </span>
          <span>
            <span className="tabular-nums text-washi">{snapshot.series_count}</span>
            <span className="ml-1">{t("snapshots.statSeries")}</span>
          </span>
          <span className={completion === 100 ? "text-gold" : "text-washi-dim"}>
            <span className="tabular-nums">{completion}%</span>
          </span>
        </div>
      </div>

      {/* Hanko stamp anchored bottom-right — brand identity for the
          plate. Slight rotation per card so the stamps don't line up. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-2 -right-2 grid h-10 w-10 place-items-center rounded-full border border-hanko/55 bg-ink-1/95 font-jp text-base font-bold text-hanko-bright shadow-md"
        style={{ transform: `rotate(${index % 2 === 0 ? "5" : "-5"}deg)` }}
      >
        印
      </span>

      {/* Paper noise — adds darkroom grain to the plate */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        }}
      />
    </button>
  );
}

// ─── Capture modal ─────────────────────────────────────────────────

function CaptureModal({ library, userName, lang, onClose, t }) {
  const create = useCreateSnapshot();
  const upload = useUploadSnapshotImage();
  const [name, setName] = useState(defaultName(t, lang));
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState("form"); // form | rendering | uploading | done | error
  const [errMsg, setErrMsg] = useState(null);

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!name.trim()) return;
    try {
      // 1. Render the canvas — heaviest step, can take 2-4s on a
      //    large library because of the cover prefetch.
      setPhase("rendering");
      const stats = computeStats(library);
      const blob = await renderShelfSnapshotBlob({
        library,
        stats,
        userName,
        locale: lang,
      });
      // 2. Create the row (stats only).
      setPhase("uploading");
      const created = await create.mutateAsync({
        name: name.trim(),
        notes: notes.trim() || null,
      });
      // 3. Attach the image. If this fails the row stays in the
      //    gallery with `has_image=false` and the user can retry.
      await upload.mutateAsync({ id: created.id, blob });
      setPhase("done");
      setTimeout(onClose, 350);
    } catch (err) {
      console.error("[snapshots] capture failed", err);
      setErrMsg(err?.message ?? "capture failed");
      setPhase("error");
    }
  }

  const submitting = phase === "rendering" || phase === "uploading";

  return (
    <Modal popupOpen={true} handleClose={submitting ? undefined : onClose}>
      <form
        onSubmit={handleSubmit}
        className="inei-capture relative w-full max-w-md overflow-hidden rounded-md border border-border bg-ink-1 p-0 shadow-2xl"
      >
        {/* Decorative torn gold corner — same vocabulary as the plates */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-12 w-12 bg-gradient-to-br from-gold/40 via-gold/15 to-transparent"
          style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}
        />

        <header className="border-b border-border/70 px-6 pt-5 pb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
            {t("snapshots.captureKicker")}
            {" · "}
            <span className="font-jp text-[12px]">撮</span>
          </p>
          <h2 className="mt-2 font-display text-xl font-light italic text-washi">
            {t("snapshots.captureTitle")}
          </h2>
          <p className="mt-1 font-display text-sm italic text-washi-muted">
            {t("snapshots.captureSubtitle")}
          </p>
        </header>

        <div className="space-y-4 px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim">
              {t("snapshots.nameLabel")} · 銘
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
              required
              className="w-full rounded-md border border-border bg-ink-0/60 px-3 py-2.5 font-display text-base italic text-washi transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim">
              {t("snapshots.notesLabel")} · 追
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={t("snapshots.notesPlaceholder")}
              className="w-full resize-y rounded-md border border-border bg-ink-0/60 px-3 py-2 font-serif text-sm leading-relaxed text-washi placeholder:italic placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </label>
        </div>

        {phase !== "form" && (
          <div className="border-t border-border/70 bg-ink-0/30 px-6 py-3">
            <PhaseIndicator phase={phase} t={t} errMsg={errMsg} />
          </div>
        )}

        <div className="flex gap-2 border-t border-border/70 bg-ink-0/40 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-md border border-border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-washi-muted transition hover:text-washi disabled:opacity-50"
          >
            {phase === "done" || phase === "error" ? t("common.close") : t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim() || phase === "done"}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-gold px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-0 transition hover:bg-gold-bright disabled:opacity-60"
          >
            <span aria-hidden="true" className="font-jp text-[12px] not-italic">
              印
            </span>
            {submitting
              ? t("snapshots.capturing")
              : phase === "done"
                ? t("common.saved")
                : t("snapshots.captureSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PhaseIndicator({ phase, t, errMsg }) {
  const map = {
    rendering: { kanji: "現", label: t("snapshots.phaseRendering"), tone: "text-gold" },
    uploading: { kanji: "送", label: t("snapshots.phaseUploading"), tone: "text-gold" },
    done: { kanji: "成", label: t("snapshots.phaseDone"), tone: "text-moegi" },
    error: { kanji: "失", label: errMsg ?? t("snapshots.phaseError"), tone: "text-hanko-bright" },
  }[phase];
  if (!map) return null;
  return (
    <div className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] ${map.tone}`}>
      <span aria-hidden="true" className="font-jp text-[14px] not-italic">
        {map.kanji}
      </span>
      <span>{map.label}</span>
      {(phase === "rendering" || phase === "uploading") && (
        <span aria-hidden="true" className="ml-auto inline-flex gap-1">
          <span className="block h-1 w-1 animate-pulse rounded-full bg-gold/80" />
          <span
            className="block h-1 w-1 animate-pulse rounded-full bg-gold/80"
            style={{ animationDelay: "200ms" }}
          />
          <span
            className="block h-1 w-1 animate-pulse rounded-full bg-gold/80"
            style={{ animationDelay: "400ms" }}
          />
        </span>
      )}
    </div>
  );
}

// ─── Detail modal ──────────────────────────────────────────────────

function DetailModal({ snapshot, onClose, lang, t }) {
  const del = useDeleteSnapshot();
  const [confirming, setConfirming] = useState(false);
  const dateLabel = formatDate(snapshot.taken_at, lang);
  const imgUrl = snapshot.has_image
    ? `/api/user/snapshots/${snapshot.id}/image`
    : null;

  async function handleDelete() {
    await del.mutateAsync(snapshot.id);
    onClose();
  }

  return (
    <Modal popupOpen={true} handleClose={onClose}>
      <div className="relative w-full max-w-3xl overflow-hidden rounded-md border border-border bg-ink-1 shadow-2xl">
        <header className="flex flex-wrap items-baseline gap-3 border-b border-border/70 px-6 py-4">
          <span className="font-jp text-xl font-bold leading-none text-hanko-bright">
            印
          </span>
          <h3 className="font-display text-lg font-light italic text-washi">
            {snapshot.name}
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
            {dateLabel}
          </span>
          <span className="ml-auto inline-flex gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em]">
            <span className="text-washi-dim">
              {snapshot.total_owned}/{snapshot.total_volumes}{" "}
              {t("snapshots.statVolumes")}
            </span>
            <span className="text-washi-dim">·</span>
            <span className="text-washi-dim">
              {snapshot.series_count} {t("snapshots.statSeries")}
            </span>
          </span>
        </header>

        {snapshot.notes && (
          <p className="border-b border-border/70 px-6 py-3 font-display text-sm italic text-washi-muted">
            {snapshot.notes}
          </p>
        )}

        <div className="bg-ink-0/40 p-4">
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={snapshot.name}
              className="mx-auto max-h-[70vh] w-auto max-w-full rounded-sm shadow-2xl"
            />
          ) : (
            <div className="grid place-items-center px-8 py-24 font-display text-base italic text-washi-dim">
              {t("snapshots.imageMissing")}
            </div>
          )}
        </div>

        <footer className="flex justify-between gap-2 border-t border-border/70 bg-ink-0/40 px-6 py-3">
          {confirming ? (
            <div className="flex flex-1 items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-hanko-bright">
                {t("snapshots.deleteConfirm")}
              </span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={del.isPending}
                className="rounded-md bg-hanko px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-washi transition hover:bg-hanko-bright disabled:opacity-50"
              >
                {del.isPending ? t("common.saving") : t("snapshots.deleteAction")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={del.isPending}
                className="rounded-md border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-muted transition hover:text-washi disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-hanko/40 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-hanko-bright transition hover:border-hanko/70 hover:bg-hanko/10"
            >
              <span aria-hidden="true" className="font-jp text-[11px] not-italic">
                消
              </span>
              {t("snapshots.deleteAction")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-muted transition hover:text-washi"
          >
            {t("common.close")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

// ─── States ────────────────────────────────────────────────────────

function EmptyPanel({ onCapture, t }) {
  return (
    <div className="mx-auto max-w-2xl rounded-md border border-border bg-ink-1/40 p-12 text-center backdrop-blur md:p-16 animate-fade-up">
      <p
        aria-hidden="true"
        className="font-jp text-7xl font-bold leading-none text-washi-dim md:text-9xl"
      >
        撮
      </p>
      <h2 className="mt-6 font-display text-xl font-light italic leading-tight text-washi md:text-2xl">
        {t("snapshots.emptyTitle")}
      </h2>
      <p className="mt-3 max-w-md mx-auto font-display text-sm italic text-washi-muted">
        {t("snapshots.emptyBody")}
      </p>
      <button
        type="button"
        onClick={onCapture}
        className="mt-8 inline-flex items-center gap-2 rounded-full border border-gold/55 bg-gold/8 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.28em] text-gold transition hover:border-gold hover:bg-gold/15"
      >
        <span aria-hidden="true" className="font-jp text-sm not-italic">
          印
        </span>
        {t("snapshots.captureCta")}
      </button>
    </div>
  );
}

function LoadingPanel({ t }) {
  return (
    <ul
      aria-label={t("common.loading")}
      className="grid gap-6 sm:grid-cols-2 sm:gap-7 lg:grid-cols-3 lg:gap-8"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="overflow-hidden rounded-md border border-border/60 bg-ink-1/40 animate-fade-up"
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <div className="relative aspect-[4/5] w-full bg-gradient-to-br from-ink-2 to-ink-3">
            <span className="absolute inset-0 animate-pulse bg-ink-2/40" />
          </div>
          <div className="space-y-2 px-4 pt-3 pb-4">
            <span className="block h-4 w-3/4 rounded bg-ink-2/60" />
            <span className="block h-3 w-1/2 rounded bg-ink-2/40" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Decorative ────────────────────────────────────────────────────

function CornerKanji() {
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-2 right-3 hidden -z-10 font-jp text-9xl font-bold leading-none text-hanko/[0.04] md:block"
        style={{ transform: "rotate(8deg)" }}
      >
        印
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-12 left-2 hidden -z-10 font-jp text-9xl font-bold leading-none text-gold/[0.05] md:block"
        style={{ transform: "rotate(-8deg)" }}
      >
        影
      </span>
    </>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function defaultName(t, lang) {
  const d = new Date();
  const month = d.toLocaleDateString(
    lang === "fr" ? "fr-FR" : lang === "es" ? "es-ES" : "en-US",
    { month: "long", year: "numeric" },
  );
  return t("snapshots.defaultName", { month });
}

function computeStats(library) {
  let totalVolumes = 0;
  let totalOwned = 0;
  let seriesCount = 0;
  let seriesComplete = 0;
  for (const m of library ?? []) {
    seriesCount += 1;
    totalVolumes += m.volumes ?? 0;
    totalOwned += m.volumes_owned ?? 0;
    if ((m.volumes ?? 0) > 0 && (m.volumes_owned ?? 0) >= (m.volumes ?? 0)) {
      seriesComplete += 1;
    }
  }
  return { totalVolumes, totalOwned, seriesCount, seriesComplete };
}

function formatDate(iso, lang) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(
      lang === "fr" ? "fr-FR" : lang === "es" ? "es-ES" : "en-US",
      { day: "2-digit", month: "short", year: "numeric" },
    );
  } catch {
    return "—";
  }
}
