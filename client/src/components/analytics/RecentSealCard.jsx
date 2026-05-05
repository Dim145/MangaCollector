/**
 * 印 · Most-recently-earned seal card.
 *
 * The hero treatment for "your latest sceau" — a hanko-red stamp
 * with the seal's kanji rotated, a date stamp underneath, and a
 * link through to the SealsPage where the ceremony lives. The
 * `tier` of the seal drives the stamp colour (sumi → black, kin
 * → gold, shikkoku → very-dark, etc.) so a brand-new high-tier
 * unlock visibly stands out on this card.
 */
import { Link } from "react-router-dom";
import { SEAL_BY_CODE, TIERS } from "@/lib/sealsCatalog.js";
import { formatShortDate } from "@/utils/date.js";

export default function RecentSealCard({ earned, t, lang, loading }) {
  if (loading) {
    return (
      <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-ink-1/40" />
    );
  }
  if (!earned || earned.length === 0) {
    return (
      <article className="rounded-2xl border border-dashed border-border/70 bg-ink-1/30 px-6 py-10 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-muted">
          {t("stats.seals.recentEyebrow")}
        </p>
        <p className="mt-3 font-display text-lg italic text-washi-muted">
          {t("stats.seals.recentEmpty")}
        </p>
        <Link
          to="/seals"
          className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-hanko transition hover:text-hanko-bright"
        >
          {t("stats.seals.cta")} →
        </Link>
      </article>
    );
  }

  // earned is sorted ascending by earned_at server-side; latest is last.
  const latest = earned[earned.length - 1];
  const meta = SEAL_BY_CODE.get(latest.code);
  const tier = TIERS[meta?.tier] ?? TIERS[1];

  // Per-tier colour palette for the stamp interior.
  const tierStyle = {
    1: { bg: "var(--ink-2)", ring: "var(--washi-dim)", glyph: "var(--washi)" },
    2: { bg: "var(--hanko)", ring: "var(--hanko-bright)", glyph: "var(--washi)" },
    3: { bg: "var(--moegi)", ring: "var(--moegi)", glyph: "var(--ink-0)" },
    4: { bg: "var(--gold)", ring: "var(--gold-bright)", glyph: "var(--ink-0)" },
    5: { bg: "var(--ink-1)", ring: "var(--gold)", glyph: "var(--gold)" },
  }[meta?.tier] ?? {
    bg: "var(--hanko)",
    ring: "var(--hanko-bright)",
    glyph: "var(--washi)",
  };

  return (
    <Link
      to="/seals"
      className="group relative isolate flex flex-col items-center gap-5 overflow-hidden rounded-2xl border border-border/70 bg-ink-1/55 px-6 py-7 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-hanko/60 hover:shadow-[0_22px_36px_-22px_rgba(176,30,42,0.55)] md:py-8"
    >
      {/* Atmospheric red bloom behind the stamp. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 right-1/2 h-48 w-48 translate-x-1/2 rounded-full bg-hanko/[0.18] blur-3xl"
      />

      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
        {t("stats.seals.recentEyebrow")}
      </p>

      {/* Hanko stamp — rotated, with the seal's kanji centred. */}
      <span
        aria-hidden="true"
        className="relative grid h-32 w-32 place-items-center rounded-full font-jp text-[3.5rem] font-bold leading-none shadow-[0_10px_30px_-12px_rgba(0,0,0,0.7)] transition-transform duration-500 group-hover:rotate-[-2deg] md:h-36 md:w-36 md:text-[4rem]"
        style={{
          background: tierStyle.bg,
          color: tierStyle.glyph,
          border: `2px double ${tierStyle.ring}`,
          transform: "rotate(-6deg)",
        }}
      >
        {meta?.kanji ?? "印"}
      </span>

      <div className="text-center">
        <h3 className="font-display text-xl font-light italic text-washi md:text-2xl">
          {t(`seals.codes.${latest.code}.label`)}
        </h3>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.24em] text-washi-muted">
          {t(`seals.tiers.${tier.name}`)}
          {" · "}
          {formatShortDate(latest.earned_at, lang)}
        </p>
      </div>

      <p className="text-center font-display text-[12px] italic text-washi-muted md:text-[13px]">
        {t(`seals.codes.${latest.code}.description`)}
      </p>

      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-hanko transition group-hover:text-hanko-bright">
        {t("stats.seals.cta")} →
      </span>
    </Link>
  );
}
