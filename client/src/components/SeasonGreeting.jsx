import { useCallback, useEffect, useState } from "react";
import {
  getCurrentSeason,
  hasGreetedSeason,
  markSeasonGreeted,
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
 *   - Manual dismiss via the close button persists immediately.
 *   - Auto-dismiss after `AUTO_DISMISS_MS` so the banner doesn't
 *     loiter on the page if the user just landed and started
 *     scrolling. Re-mounting the dashboard during the same session
 *     won't re-show it (the seen flag survives in localStorage).
 *   - Renders nothing until React has confirmed mount + seen state,
 *     which avoids a brief flash of the banner during hydration on
 *     a session that already saw it.
 */
const AUTO_DISMISS_MS = 14000;

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
  const [season, setSeason] = useState(null);

  useEffect(() => {
    const current = getCurrentSeason();
    if (!hasGreetedSeason(current)) {
      setSeason(current);
    }
  }, []);

  // 儀 · Stable `dismiss` reference. The previous version was a
  // function declaration recreated on every render, captured by the
  // auto-dismiss timer's closure on the render where the timer was
  // installed. If `season` evolved between then and the timer firing
  // (e.g. a manual click flipped to null first), the closure could
  // call markSeasonGreeted on a stale value. `useCallback` rebinds
  // the function only when `season` changes, so the timer effect
  // can list it as a dep without re-triggering on incidental
  // re-renders.
  const dismiss = useCallback(() => {
    if (!season) return;
    markSeasonGreeted(season);
    setSeason(null);
  }, [season]);

  useEffect(() => {
    if (!season) return;
    const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [season, dismiss]);

  if (!season) return null;
  const preset = SEASON_PRESETS[season];

  return (
    <aside
      role="status"
      aria-live="polite"
      className={`relative mb-8 overflow-hidden rounded-2xl border bg-gradient-to-br p-5 backdrop-blur animate-fade-up ${preset.border} ${preset.background}`}
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

      <div className="relative flex items-center gap-4">
        {/* Big kanji medallion — same visual tier as the empty-state
            and tour kanji, so the season feels like part of the
            same typographic family rather than a foreign chip. */}
        <span
          aria-hidden="true"
          className={`shrink-0 font-jp text-5xl font-bold leading-none md:text-6xl ${preset.accent}`}
        >
          {preset.kanji}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {preset.sekki} · {preset.sekkiRomaji}
          </p>
          <p className="mt-1 font-display text-base italic leading-snug text-washi md:text-lg">
            {t(`season.poetic_${season}`)}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
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
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-washi-dim transition hover:border-hanko/50 hover:text-washi"
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
