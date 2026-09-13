import { useEffect, useState } from "react";
import { useT, useLang } from "@/i18n/index.jsx";
import { useStartReread, useUpdateMangaMeta } from "@/hooks/useLibrary.js";
import { formatShortDate } from "@/utils/date.js";

/**
 * 読 · Reading progression for one series — where the reader stands
 * with the work as a whole, next to the emaki that shows which tomes
 * were read.
 *
 * Five states as a row of chips (予 planned · 読 reading · 休 paused ·
 * 了 finished · 断 dropped), the day the read started and ended, the
 * read-through tally, and a 再読 "read again" action. The server keeps
 * status and dates in step with the tomes marked read; everything here
 * is an override the user can make by hand, saved immediately through
 * the offline-first library patch — no edit mode needed.
 *
 * `series` is the live library row (Dexie), so a flip made from the
 * volume drawer or another device shows up without a refetch.
 */

const READING_STATUSES = [
  { id: "planned", glyph: "予", key: "manga.readingStatusPlanned" },
  { id: "reading", glyph: "読", key: "manga.readingStatusReading" },
  { id: "paused", glyph: "休", key: "manga.readingStatusPaused" },
  { id: "completed", glyph: "了", key: "manga.readingStatusCompleted" },
  { id: "dropped", glyph: "断", key: "manga.readingStatusDropped" },
];

const toneFor = (id) =>
  id === "completed"
    ? "border-gold/60 bg-gold/10 text-gold"
    : id === "reading"
      ? "border-moegi/60 bg-moegi/10 text-moegi"
      : id === "dropped"
        ? "border-hanko/50 bg-hanko/10 text-hanko-bright"
        : "border-washi/40 bg-ink-0/40 text-washi";

export default function ReadingProgress({ series }) {
  const t = useT();
  const lang = useLang();
  const updateMeta = useUpdateMangaMeta();
  const reread = useStartReread();
  const [confirming, setConfirming] = useState(false);

  // Leave the confirm strip when the row changes under us (the reread
  // landed, or another device moved the series).
  useEffect(() => {
    setConfirming(false);
  }, [series?.times_read, series?.reading_status]);

  if (!series) return null;
  const malId = series.mal_id;
  const status = series.reading_status ?? null;
  const started = series.started_reading_at ?? null;
  const finished = series.finished_reading_at ?? null;
  const timesRead = series.times_read ?? 0;
  const finishedOnce = status === "completed" || Boolean(finished);
  const busy = updateMeta.isPending || reread.isPending;

  const setStatus = (id) =>
    updateMeta.mutate({
      mal_id: malId,
      reading_status: id === status ? "" : id,
    });
  const setDate = (field, value) =>
    updateMeta.mutate({ mal_id: malId, [field]: value || null });

  return (
    <div className="mt-6 border-t border-border/70 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
          {t("manga.progressLabel")}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-washi-muted tabular-nums">
          {timesRead === 0
            ? t("manga.readingNeverFinished")
            : timesRead === 1
              ? t("manga.readingTimesReadOnce")
              : t("manga.readingTimesRead", { n: timesRead })}
        </p>
      </div>

      {/* Status chips — a radio group; the active chip clears on click */}
      <div
        role="radiogroup"
        aria-label={t("manga.progressLabel")}
        className="mt-2.5 flex flex-wrap gap-1.5"
      >
        {READING_STATUSES.map((opt) => {
          const active = opt.id === status;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => setStatus(opt.id)}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition disabled:opacity-50 ${
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
        {status === null && (
          <span className="self-center font-display text-[11px] italic text-washi-dim">
            {t("manga.readingStatusNone")} · {t("manga.readingStatusHint")}
          </span>
        )}
      </div>

      {/* Dates + read-again */}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <DateField
          id={`reading-started-${malId}`}
          label={t("manga.readingStarted")}
          value={started}
          display={formatShortDate(started, lang)}
          onChange={(v) => setDate("started_reading_at", v)}
          disabled={busy}
        />
        <DateField
          id={`reading-finished-${malId}`}
          label={t("manga.readingFinished")}
          value={finished}
          display={formatShortDate(finished, lang)}
          onChange={(v) => setDate("finished_reading_at", v)}
          disabled={busy}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="max-w-[18rem] font-display text-[11px] italic leading-snug text-washi-muted">
                {t("manga.readingRereadConfirm")}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => reread.mutate(malId)}
                className="inline-flex items-center gap-1.5 rounded-full bg-hanko px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-washi transition hover:bg-hanko-bright disabled:opacity-50"
              >
                <span
                  aria-hidden="true"
                  className="font-jp text-[12px] leading-none"
                >
                  再
                </span>
                {t("manga.readingRereadYes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-full border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-washi-muted transition hover:text-washi"
              >
                {t("manga.readingRereadNo")}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy || !finishedOnce}
              title={
                finishedOnce
                  ? t("manga.readingRereadCta")
                  : t("manga.readingRereadNeedsFinish")
              }
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span
                aria-hidden="true"
                className="font-jp text-[12px] leading-none"
              >
                再
              </span>
              {t("manga.readingRereadCta")}
            </button>
          )}
        </div>
      </div>
      {reread.isError && (
        <p className="mt-2 font-mono text-[10px] text-hanko-bright">
          {reread.error?.response?.data?.error ?? t("common.genericError")}
        </p>
      )}
    </div>
  );
}

/** A labelled date input that reads as inscription until focused. */
function DateField({ id, label, value, display, onChange, disabled }) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
        {display ? (
          <span className="ml-1.5 normal-case tracking-normal text-washi">
            · {display}
          </span>
        ) : null}
      </span>
      <input
        id={id}
        type="date"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-ink-0/60 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-washi transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20 disabled:opacity-50"
      />
    </label>
  );
}
