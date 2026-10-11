import { useEffect, useState } from "react";
import {
  dismissSeasonBanner,
  getCurrentSeason,
  markSeasonShown,
  seasonBannerShows,
} from "@/lib/season.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 季節 · Once-per-season nudge that surfaces at the top of the
 * dashboard on the user's first visit during a new real-world
 * Japanese season. The banner names the sekki transition (立春,
 * 立夏, 立秋, 立冬), the season's kanji, and a poetic line about how
 * the archive is repainted.
 *
 * Behaviour:
 *   - Visible only when the current season hasn't been greeted yet
 *     (localStorage `mc:season-greeted` keyed on `season-YYYY`).
 *   - The season counts as greeted as soon as the banner is shown, so
 *     it appears on one visit: the next session opens straight on the
 *     shelf. Within the visit it stays (`seasonBannerShows`): coming
 *     back from a series to a dashboard without it moved the shelf up
 *     by its height, and the scroll memory landed a row off.
 *   - It stays for that visit unless the close button removes it. It
 *     used to remove itself after 14 s, and the whole shelf jumped up
 *     by its height under a reader who had started looking at covers —
 *     a layout shift nobody asked for, the kind CLS counts.
 */

const SEASON_PRESETS = {
  spring: {
    kanji: "春",
    sekki: "立春",
    sekkiRomaji: "risshun",
    border: "border-sakura/45",
    background: "from-sakura/15 via-ink-1/70 to-ink-1/40",
    accent: "text-sakura",
  },
  summer: {
    kanji: "夏",
    sekki: "立夏",
    sekkiRomaji: "rikka",
    border: "border-moegi/45",
    background: "from-moegi/15 via-ink-1/70 to-ink-1/40",
    accent: "text-moegi",
  },
  autumn: {
    kanji: "秋",
    sekki: "立秋",
    sekkiRomaji: "risshū",
    border: "border-gold/45",
    background: "from-gold/15 via-ink-1/70 to-ink-1/40",
    accent: "text-gold",
  },
  winter: {
    kanji: "冬",
    sekki: "立冬",
    sekkiRomaji: "rittō",
    border: "border-border",
    background: "from-washi/8 via-ink-1/70 to-ink-1/40",
    accent: "text-washi",
  },
};

export default function SeasonGreeting() {
  const t = useT();
  // `null` while we resolve whether the banner should show — keeps
  // SSR-style hydration paths from flashing the wrong state.
  // 初 · Decided in the first render, not in an effect after it. Both
  // reads are synchronous (a date and a localStorage flag), and mounting
  // the banner one render late pushed the whole dashboard — controls,
  // filters, grid — down by its own height on every visit that showed
  // it: a 0.07 layout shift on desktop for a banner that could simply
  // have been there from the first paint.
  const [season, setSeason] = useState(() => {
    const current = getCurrentSeason();
    return seasonBannerShows(current) ? current : null;
  });

  // Greeted once shown (see the module comment); the close button takes
  // the banner off for the rest of the visit.
  useEffect(() => {
    if (season) markSeasonShown(season);
  }, [season]);
  const dismiss = () => {
    dismissSeasonBanner();
    setSeason(null);
  };

  if (!season) return null;
  const preset = SEASON_PRESETS[season];

  return (
    // A note beside the page, not a live region: it is there when the
    // page opens, which a status announces nothing about (and `aside`
    // may not carry that role).
    <aside
      aria-label={t("season.greetingAria")}
      className={`relative mb-3 overflow-hidden rounded-2xl border bg-gradient-to-br px-3.5 py-2.5 backdrop-blur animate-fade-up sm:mb-8 sm:p-5 ${preset.border} ${preset.background}`}
    >
      {/* Ornamental kanji watermark — pinned to the corner so the
          season's signature lives in the negative space without
          stealing the eye from the inline text. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute -bottom-6 -right-2 select-none font-display italic font-light leading-none ${preset.accent}`}
        style={{ fontSize: "9rem", opacity: 0.08 }}
      >
        {preset.kanji}
      </span>

      <div className="relative flex items-center gap-3 sm:gap-4">
        {/* Big kanji medallion — same visual tier as the empty-state
            and tour kanji, so the season feels like part of the
            same typographic family rather than a foreign chip. */}
        <span
          aria-hidden="true"
          className={`shrink-0 font-jp text-2xl font-bold leading-none sm:text-5xl md:text-6xl ${preset.accent}`}
        >
          {preset.kanji}
        </span>

        <div className="min-w-0 flex-1">
          {/* 帯 · The sekki's name reads from `sm:` up; on a phone the
              kanji beside the line already says which season it is. */}
          <p className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim sm:block">
            {preset.sekki} · {preset.sekkiRomaji}
          </p>
          {/* 帯 · On a phone the line is set a size down and kept to
              two lines: this banner opens the shelf once a season, and
              every line it takes there is a line of covers below the fold. */}
          <p className="line-clamp-2 font-display text-sm italic leading-snug text-washi sm:mt-1 sm:text-base md:text-lg">
            {t(`season.poetic_${season}`)}
          </p>
          {/* The third line is the one that pushed the shelf below the
              fold on a phone; it reads from `sm:` up. */}
          <p className="mt-1 hidden font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim sm:block">
            {t(`season.subtle_${season}`)}
          </p>
        </div>

        {/* Dismiss — quiet outline button. The banner self-closes
            anyway, but giving the user a clear escape hatch beats
            forcing them to wait out the timer. */}
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("season.dismissAria")}
          // 44 px under a finger through the hit area, not the circle:
          // the circle would set the banner's height on a phone.
          className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-washi-dim transition after:absolute after:-inset-1.5 hover:border-hanko/50 hover:text-washi sm:h-9 sm:w-9"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
