/**
 * 暦 · Temporal study — two cards side-by-side.
 *
 *   - Saison favorite : best quarter (most events) ever.
 *   - Anniversaire    : how long the user has been archiving,
 *                        plus the very first series they added.
 */
import { Link } from "react-router-dom";
import CoverImage from "../ui/CoverImage.jsx";
import StatLedgerCard from "./StatLedgerCard.jsx";
import { formatShortDate } from "@/utils/date.js";

export default function TimeStudy({ bestQuarter, anniversary, t, lang, loading }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <BestQuarterCard quarter={bestQuarter} t={t} loading={loading} />
      <AnniversaryCard anniversary={anniversary} t={t} lang={lang} loading={loading} />
    </div>
  );
}

function BestQuarterCard({ quarter, t, loading }) {
  return (
    <StatLedgerCard
      kanji="季"
      eyebrow={t("stats.time.bestQuarterEyebrow")}
      value={
        loading
          ? "—"
          : quarter
            ? quarter.label
            : t("stats.time.bestQuarterEmpty")
      }
      sub={
        loading || !quarter
          ? null
          : t("stats.time.bestQuarterEvents", { n: quarter.count })
      }
      hint={t("stats.time.bestQuarterHint")}
      loading={loading}
    >
      {!loading && quarter ? <SeasonGlyph quarter={quarter} /> : null}
    </StatLedgerCard>
  );
}

/**
 * Decorative glyph for the favourite season — picks an accent
 * kanji for spring / summer / autumn / winter based on the
 * quarter index, rendered as a calligraphic stamp.
 */
function SeasonGlyph({ quarter }) {
  const q = parseInt(quarter.key.split("-Q")[1] ?? "0", 10);
  // 1 → 桜 (spring), 2 → 夏 (summer), 3 → 楓 (autumn), 4 → 雪 (winter)
  const map = { 1: "桜", 2: "夏", 3: "楓", 4: "雪" };
  const glyph = map[q] ?? "季";
  return (
    <div className="flex items-center justify-between">
      <span
        aria-hidden="true"
        className="font-jp text-3xl font-bold leading-none"
        style={{
          color: "var(--folio-accent, var(--ai))",
          transform: "rotate(-3deg)",
          display: "inline-block",
        }}
      >
        {glyph}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
        Q{q}
      </span>
    </div>
  );
}

function AnniversaryCard({ anniversary, t, lang, loading }) {
  if (loading) {
    return (
      <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-ink-1/40" />
    );
  }
  if (!anniversary) {
    return (
      <StatLedgerCard
        kanji="始"
        eyebrow={t("stats.time.anniversaryEyebrow")}
        value="—"
        hint={t("stats.time.anniversaryEmpty")}
        loading={false}
      />
    );
  }

  const years = Math.floor(anniversary.days / 365);
  const remDays = anniversary.days - years * 365;
  const months = Math.floor(remDays / 30);
  const formatted = years > 0
    ? t("stats.time.anniversaryYearsMonths", { y: years, m: months })
    : t("stats.time.anniversaryDays", { n: anniversary.days });

  const since = formatShortDate(anniversary.firstSeriesAt, lang);

  return (
    <article className="group relative isolate flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-ink-1/55 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[color:var(--folio-accent,var(--ai))]/55 hover:shadow-[0_22px_36px_-22px_color-mix(in_oklab,var(--folio-accent,var(--ai))_55%,transparent)]">
      <span
        aria-hidden="true"
        className="absolute right-3 top-3 font-jp text-3xl font-bold leading-none"
        style={{
          color: "var(--folio-accent, var(--ai))",
          opacity: 0.32,
          transform: "rotate(-5deg)",
        }}
      >
        始
      </span>

      <div className="px-5 pt-5 md:px-6 md:pt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-muted">
          {t("stats.time.anniversaryEyebrow")}
        </p>
        <p className="mt-2 font-display text-3xl font-light italic leading-none tracking-tight text-washi md:text-4xl">
          {formatted}
        </p>
        <p className="mt-2 font-display text-[12px] italic text-washi-muted md:text-[13px]">
          {t("stats.time.anniversaryHint", { since })}
        </p>
      </div>

      {/* First-series mini-card — links to its mangapage. */}
      <Link
        to={`/mangapage?mal_id=${anniversary.firstSeriesMalId}`}
        className="mt-5 flex items-center gap-3 border-t border-border/60 bg-ink-2/40 px-5 py-3 transition hover:bg-ink-2/60 md:px-6"
      >
        <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md border border-border/70 bg-ink-2">
          {anniversary.firstSeriesPoster ? (
            <CoverImage
              src={anniversary.firstSeriesPoster}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-jp text-base font-bold text-hanko/40">
              巻
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-washi-dim">
            {t("stats.time.firstSeriesEyebrow")}
          </p>
          <p className="truncate font-display text-sm italic text-washi md:text-base">
            {anniversary.firstSeriesName}
          </p>
        </div>
      </Link>
    </article>
  );
}
