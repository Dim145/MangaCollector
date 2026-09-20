/* eslint-disable react-refresh/only-export-components --
 * Same trade-off as `PublisherEditionField`: the vocabulary and the two
 * components that render it belong together. Dev-only rule.
 */
import { useT } from "@/i18n/index.jsx";

/**
 * 版 · What the edition on the shelf is doing.
 *
 * MyAnimeList tracks the Japanese original: One Piece is "ongoing"
 * there whatever happened to the edition the reader owns. A series can
 * be finished in French, stopped mid-run when a publisher drops it, or
 * paused while a licence is renegotiated — and until now none of that
 * was sayable, so the calendar kept announcing volumes that will never
 * be printed.
 *
 * The four states are the server's (`PUBLICATION_STATUSES`); two of
 * them — concluded and discontinued — mean no more volumes are coming,
 * which is what the calendar and the nightly sweep read.
 *
 * Each state carries its own kanji *and* its own words: the colour is
 * the third signal, never the only one. The glyphs are deliberately
 * not 完 or 休 — those already mean "collection complete" and "reading
 * paused" elsewhere in the app, and two meanings on one mark is how a
 * glossary stops helping.
 */
export const EDITION_STATUSES = [
  { id: "ongoing", glyph: "刊", key: "manga.editionStatusOngoing" },
  { id: "paused", glyph: "停", key: "manga.editionStatusPaused" },
  { id: "completed", glyph: "結", key: "manga.editionStatusCompleted" },
  { id: "stopped", glyph: "絶", key: "manga.editionStatusStopped" },
];

const toneFor = (id) =>
  id === "ongoing"
    ? "border-moegi/60 bg-moegi/10 text-moegi"
    : id === "completed"
      ? "border-ai/60 bg-ai/10 text-ai"
      : id === "stopped"
        ? "border-hanko/50 bg-hanko/10 text-hanko-bright"
        : "border-gold/60 bg-gold/10 text-gold";

/** The read-only pill, shown beside the publisher line when set. */
export function EditionStatusBadge({ status }) {
  const t = useT();
  const option = EDITION_STATUSES.find((o) => o.id === status);
  if (!option) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${toneFor(option.id)}`}
      title={t("manga.editionStatusLabel")}
    >
      <span aria-hidden="true" className="font-jp text-[12px] leading-none">
        {option.glyph}
      </span>
      <span className="sr-only">{t("manga.editionStatusLabel")} : </span>
      {t(option.key)}
    </span>
  );
}

/**
 * The picker, in the series' edit block. A radio group whose active
 * chip clears on a second click — same contract as the reading status
 * above it, so the two read as one family.
 */
export function EditionStatusPicker({ value, onChange, disabled = false }) {
  const t = useT();
  return (
    <div>
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
        {t("manga.editionStatusLabel")}
      </span>
      <div
        role="radiogroup"
        aria-label={t("manga.editionStatusLabel")}
        className="flex flex-wrap gap-1.5"
      >
        {EDITION_STATUSES.map((opt) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(active ? "" : opt.id)}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition pointer-coarse:min-h-11 disabled:opacity-50 ${
                active
                  ? toneFor(opt.id)
                  : "border-border text-washi-muted hover:border-washi-dim hover:text-washi"
              }`}
            >
              <span
                aria-hidden="true"
                className="font-jp text-[12px] leading-none"
              >
                {opt.glyph}
              </span>
              <span>{t(opt.key)}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 font-display text-[11px] italic leading-snug text-washi-dim">
        {t("manga.editionStatusHint")}
      </p>
    </div>
  );
}
