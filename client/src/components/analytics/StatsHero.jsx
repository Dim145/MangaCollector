/**
 * 帳 · StatsPage hero — opens the ledger.
 *
 * Big rotated 帳 watermark, eyebrow + display title, optional sub-
 * heading, and a back link to /profile. Designed to span the page
 * width so it sets the tonality before the section nav kicks in.
 *
 * Subtitle prose rotates daily — see `lib/dailyTexts.js`. The
 * pool stays on theme ("the ledger of an archivist") so the
 * page voice is consistent regardless of which line surfaces
 * on a given day.
 */
import { Link } from "react-router-dom";
import { useDailyStatsSubtitle } from "@/lib/dailyTexts.js";

export default function StatsHero({ t, totals, loading }) {
  const dailySubtitle = useDailyStatsSubtitle();
  const heroStats = [
    {
      kanji: "巻",
      label: t("stats.hero.volumes"),
      value: loading ? "—" : `${totals?.ownedVolumeCount ?? 0}`,
    },
    {
      kanji: "棚",
      label: t("stats.hero.series"),
      value: loading ? "—" : `${totals?.seriesCount ?? 0}`,
    },
    {
      kanji: "%",
      label: t("stats.hero.completion"),
      value: loading ? "—" : `${totals?.completionPct ?? 0} %`,
    },
    {
      kanji: "印",
      label: t("stats.hero.seals"),
      value: loading ? "—" : `${totals?.sealsCount ?? 0}`,
    },
  ];

  return (
    <header className="relative isolate overflow-hidden border-b border-border/60 px-4 pt-12 pb-12 sm:px-6 md:pt-20 md:pb-16">
      {/* Massive rotated kanji watermark. Sits behind the text;
          pointer events disabled. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 top-2 select-none font-jp text-[clamp(11rem,28vw,22rem)] font-bold leading-none text-hanko/[0.07] md:-right-16"
        style={{ transform: "rotate(-6deg)" }}
      >
        帳
      </span>

      {/* Atmosphere — diagonal hanko + gold blooms. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -top-32 -z-10 h-[28rem] w-[28rem] rounded-full bg-hanko/[0.08] blur-3xl"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 bottom-0 -z-10 h-[24rem] w-[24rem] rounded-full bg-gold/[0.06] blur-3xl"
      />

      <div className="relative mx-auto max-w-6xl">
        <div className="flex items-center gap-3">
          <Link
            to="/profile"
            className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim transition hover:text-washi"
          >
            <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            {t("stats.backToProfile")}
          </Link>
        </div>

        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.32em] text-hanko">
          {t("stats.hero.eyebrow")}
        </p>

        <h1 className="mt-3 font-display text-4xl font-light leading-[1.02] tracking-tight text-washi sm:text-5xl md:text-6xl lg:text-7xl">
          {t("stats.hero.titlePre")}{" "}
          <em className="text-hanko-gradient italic font-semibold not-italic md:italic">
            {t("stats.hero.titleAccent")}
          </em>
          {t("stats.hero.titlePost")}
        </h1>

        <p className="mt-5 max-w-2xl font-display text-base italic leading-relaxed text-washi-muted md:text-lg">
          {dailySubtitle}
        </p>

        {/* Hero stat row — four ceremonial figures. Renders as a
            single row on desktop, 2×2 on mobile. */}
        <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/40 md:grid-cols-4">
          {heroStats.map((s) => (
            <div
              key={s.kanji + s.label}
              className="relative bg-ink-1/65 px-4 py-5 backdrop-blur-sm md:px-6 md:py-6"
            >
              <span
                aria-hidden="true"
                className="absolute right-2 top-2 font-jp text-2xl font-bold leading-none text-hanko/40 md:text-3xl"
                style={{ transform: "rotate(-4deg)" }}
              >
                {s.kanji}
              </span>
              <dt className="font-mono text-[10px] uppercase tracking-[0.26em] text-washi-muted">
                {s.label}
              </dt>
              <dd className="mt-2 font-display text-3xl font-light italic leading-none tracking-tight text-washi md:text-4xl">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}
