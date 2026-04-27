import { useEffect, useId, useMemo, useRef, useState } from "react";
import Modal from "@/components/ui/Modal.jsx";
import {
  useAddUpcomingVolume,
  useUpdateUpcomingVolume,
} from "@/hooks/useVolumes.js";
import { notifySyncInfo } from "@/lib/sync.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 来 · AddUpcomingVolumeModal — pencils a tome onto the calendar.
 *
 * Two modes:
 *   - **create**: `editingVolume == null`. The form pre-fills `vol_num`
 *     with the next number after the highest known volume (suggestion
 *     only; the user can override).
 *   - **edit**: `editingVolume != null`. The form is hydrated from the
 *     volume row. Only release-side fields (date, ISBN, URL) can be
 *     changed here — ownership / read / collector / price / store flow
 *     through the regular Volume drawer.
 *
 * Validation runs both client-side (cheap, surfaces errors instantly)
 * and server-side (defence in depth: empty strings, off-shape ISBNs,
 * past dates are rejected at both ends).
 */
export default function AddUpcomingVolumeModal({
  open,
  onClose,
  manga,
  highestKnownVolNum = 0,
  // When `editingVolume` is provided, the modal flips to edit mode.
  // Shape: { id, vol_num, release_date, release_isbn, release_url }
  editingVolume = null,
}) {
  const t = useT();
  const isEditing = Boolean(editingVolume);

  const fieldId = useId();
  const firstInputRef = useRef(null);

  const addUpcoming = useAddUpcomingVolume();
  const editUpcoming = useUpdateUpcomingVolume();

  const initialDate = useMemo(() => {
    if (editingVolume?.release_date) {
      return formatDateForInput(editingVolume.release_date);
    }
    // Default to one month from now — typical lead time for a tome
    // pre-order, comfortably beyond the "tomorrow at the earliest"
    // server validation.
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return formatDateForInput(d.toISOString());
  }, [editingVolume]);

  const initialVolNum = isEditing
    ? String(editingVolume.vol_num)
    : String(Math.max(1, highestKnownVolNum + 1));

  const [volNum, setVolNum] = useState(initialVolNum);
  const [releaseDate, setReleaseDate] = useState(initialDate);
  const [releaseIsbn, setReleaseIsbn] = useState(
    editingVolume?.release_isbn ?? "",
  );
  const [releaseUrl, setReleaseUrl] = useState(
    editingVolume?.release_url ?? "",
  );
  const [error, setError] = useState(null);

  // Re-seed when the modal opens or the editing target changes.
  useEffect(() => {
    if (!open) return;
    setVolNum(initialVolNum);
    setReleaseDate(initialDate);
    setReleaseIsbn(editingVolume?.release_isbn ?? "");
    setReleaseUrl(editingVolume?.release_url ?? "");
    setError(null);
    // Push focus to the first input on open so a keyboard user can type
    // immediately. requestAnimationFrame ensures the input exists.
    requestAnimationFrame(() => firstInputRef.current?.focus());
  }, [open, initialVolNum, initialDate, editingVolume]);

  const isPending = addUpcoming.isPending || editUpcoming.isPending;
  const seriesName = manga?.name ?? "—";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isPending) return;
    setError(null);

    // ── Client-side validation ────────────────────────────────────────
    const numericVol = Number.parseInt(volNum, 10);
    if (!Number.isFinite(numericVol) || numericVol < 1) {
      setError(t("manga.upcomingErrGeneric"));
      return;
    }
    if (!releaseDate) {
      setError(t("manga.upcomingErrPastDate"));
      return;
    }
    // The native <input type="date"> stores midnight-local. We coerce
    // to end-of-day-UTC so a date picked "today" still passes the
    // server's "strictly future" guard for users in any timezone.
    const dateValue = new Date(`${releaseDate}T23:59:59Z`);
    if (Number.isNaN(dateValue.getTime()) || dateValue <= new Date()) {
      setError(t("manga.upcomingErrPastDate"));
      return;
    }
    if (releaseIsbn.trim()) {
      const cleaned = releaseIsbn.replace(/[^0-9Xx]/g, "");
      if (cleaned.length !== 10 && cleaned.length !== 13) {
        setError(t("manga.upcomingErrIsbn"));
        return;
      }
    }
    if (releaseUrl.trim()) {
      const u = releaseUrl.trim();
      if (!(u.startsWith("http://") || u.startsWith("https://"))) {
        setError(t("manga.upcomingErrUrl"));
        return;
      }
    }

    const payload = {
      release_date: dateValue.toISOString(),
      release_isbn: releaseIsbn.trim() || null,
      release_url: releaseUrl.trim() || null,
    };

    try {
      let resultVol;
      if (isEditing) {
        resultVol = await editUpcoming.mutateAsync({
          id: editingVolume.id,
          ...payload,
        });
      } else {
        resultVol = await addUpcoming.mutateAsync({
          mal_id: manga.mal_id,
          vol_num: numericVol,
          ...payload,
        });
      }
      const niceDate = formatDateForToast(resultVol?.release_date ?? releaseDate);
      notifySyncInfo({
        title: t(isEditing ? "manga.upcomingUpdatedTitle" : "manga.upcomingCreatedTitle", {
          n: resultVol?.vol_num ?? numericVol,
        }),
        body: t(isEditing ? "manga.upcomingUpdatedBody" : "manga.upcomingCreatedBody", {
          name: seriesName,
          n: resultVol?.vol_num ?? numericVol,
          date: niceDate,
        }),
      });
      onClose();
    } catch (err) {
      // Translate the server's status into a friendly inline message.
      const status = err?.response?.status;
      if (status === 409) setError(t("manga.upcomingErrConflict"));
      else if (status === 400) {
        const detail = err?.response?.data?.error ?? "";
        if (/isbn/i.test(detail)) setError(t("manga.upcomingErrIsbn"));
        else if (/url/i.test(detail)) setError(t("manga.upcomingErrUrl"));
        else if (/future|date/i.test(detail))
          setError(t("manga.upcomingErrPastDate"));
        else setError(t("manga.upcomingErrGeneric"));
      } else setError(t("manga.upcomingErrGeneric"));
    }
  };

  return (
    <Modal popupOpen={open} handleClose={isPending ? undefined : onClose}>
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-moegi/30 bg-gradient-to-br from-ink-1 via-ink-1 to-moegi/[0.04] p-6 shadow-2xl"
      >
        {/* 来 watermark — large faint kanji behind the form, same as
            the upcoming-mode VolumeDetailDrawer. Anchors the modal
            to the upcoming visual vocabulary. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-6 -top-6 select-none font-jp text-[14rem] font-bold leading-none text-moegi/[0.06]"
          style={{ writingMode: "vertical-rl" }}
        >
          来
        </span>

        {/* Header — moegi-tinted hanko stamp + chapter heading style. */}
        <div className="relative z-10 flex items-start gap-4">
          <span
            aria-hidden="true"
            className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-gradient-to-br from-moegi to-moegi-muted text-ink-0 shadow-[0_4px_14px_rgba(163,201,97,0.45)]"
            style={{ transform: "rotate(-3deg)" }}
          >
            <span className="font-jp text-2xl font-bold leading-none">来</span>
          </span>
          <div className="min-w-0 pt-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-moegi-muted">
              {t("manga.upcomingModalEyebrow")}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold italic leading-tight text-washi">
              {t("manga.upcomingModalTitle")}
            </h2>
            <p className="mt-1 text-xs text-washi-muted">
              {t("manga.upcomingModalLead")}
            </p>
          </div>
        </div>

        {/* Brushstroke divider in moegi (matching the upcoming-volume
            visual vocabulary, distinct from the hanko-red dividers
            elsewhere in the app). */}
        <svg
          viewBox="0 0 600 8"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="relative z-10 mt-4 h-2 w-full"
        >
          <defs>
            <linearGradient id="moegi-brush" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--moegi)" stopOpacity="0" />
              <stop offset="20%" stopColor="var(--moegi)" stopOpacity="0.7" />
              <stop offset="50%" stopColor="var(--moegi)" stopOpacity="1" />
              <stop offset="80%" stopColor="var(--moegi)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="var(--moegi)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M2,4 Q150,1 300,4 T598,3"
            stroke="url(#moegi-brush)"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        </svg>

        {/* Series caption — read-only echo of which manga we're stamping
            so the user keeps context once the modal covers the page. */}
        <p className="relative z-10 mt-4 flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
          <span>{t("manga.upcomingModalSeries")}</span>
          <span className="truncate font-display text-sm font-semibold normal-case tracking-normal text-washi">
            {seriesName}
          </span>
        </p>

        <div className="relative z-10 mt-5 grid grid-cols-2 gap-3">
          {/* Volume number */}
          <Field label={t("manga.upcomingFieldVolNum")} hint={t("manga.upcomingFieldVolNumHint")}>
            <input
              ref={firstInputRef}
              id={`${fieldId}-vol`}
              type="number"
              min="1"
              step="1"
              value={volNum}
              onChange={(e) => setVolNum(e.target.value)}
              disabled={isEditing || isPending}
              required
              className="w-full rounded-lg border border-border bg-ink-0/60 px-3 py-2 font-mono text-sm text-washi transition focus:border-moegi/60 focus:outline-none focus:ring-2 focus:ring-moegi/20 disabled:opacity-50"
            />
          </Field>

          {/* Release date */}
          <Field label={t("manga.upcomingFieldDate")} hint={t("manga.upcomingFieldDateHint")}>
            <input
              id={`${fieldId}-date`}
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
              min={tomorrow()}
              disabled={isPending}
              required
              className="w-full rounded-lg border border-border bg-ink-0/60 px-3 py-2 font-mono text-sm text-washi transition focus:border-moegi/60 focus:outline-none focus:ring-2 focus:ring-moegi/20 disabled:opacity-50"
            />
          </Field>
        </div>

        <div className="relative z-10 mt-3 grid gap-3">
          <Field label={t("manga.upcomingFieldIsbn")}>
            <input
              id={`${fieldId}-isbn`}
              type="text"
              value={releaseIsbn}
              onChange={(e) => setReleaseIsbn(e.target.value)}
              placeholder={t("manga.upcomingFieldIsbnPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={isPending}
              className="w-full rounded-lg border border-border bg-ink-0/60 px-3 py-2 font-mono text-sm text-washi placeholder:text-washi-dim transition focus:border-moegi/60 focus:outline-none focus:ring-2 focus:ring-moegi/20 disabled:opacity-50"
            />
          </Field>

          <Field label={t("manga.upcomingFieldUrl")}>
            <input
              id={`${fieldId}-url`}
              type="url"
              value={releaseUrl}
              onChange={(e) => setReleaseUrl(e.target.value)}
              placeholder={t("manga.upcomingFieldUrlPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={isPending}
              className="w-full rounded-lg border border-border bg-ink-0/60 px-3 py-2 font-mono text-sm text-washi placeholder:text-washi-dim transition focus:border-moegi/60 focus:outline-none focus:ring-2 focus:ring-moegi/20 disabled:opacity-50"
            />
          </Field>
        </div>

        {error && (
          <p
            role="alert"
            className="relative z-10 mt-4 rounded-lg border border-hanko/30 bg-hanko/10 p-3 text-xs text-hanko-bright"
          >
            {error}
          </p>
        )}

        <div className="relative z-10 mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi disabled:opacity-50"
          >
            {/* Reuse the existing common.cancel — no new key needed. */}
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 rounded-lg bg-gradient-to-br from-moegi to-moegi-muted px-4 py-2 text-sm font-bold uppercase tracking-wider text-ink-0 shadow-[0_4px_14px_rgba(163,201,97,0.45)] transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-0/30 border-t-ink-0" />
                {t("manga.upcomingSubmitting")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="font-jp text-base leading-none">
                  印
                </span>
                {t(isEditing ? "manga.upcomingSubmitEdit" : "manga.upcomingSubmitCreate")}
              </span>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
          {label}
        </span>
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[10px] text-washi-muted">{hint}</span>
      )}
    </label>
  );
}

function formatDateForInput(iso) {
  // <input type="date"> wants `YYYY-MM-DD` in the user's local timezone.
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return "";
  }
}

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatDateForInput(d.toISOString());
}

function formatDateForToast(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
