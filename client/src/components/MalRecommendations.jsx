import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Skeleton from "./ui/Skeleton.jsx";
import { useMalRecommendations } from "@/hooks/useMalRecommendations.js";
import { useT } from "@/i18n/index.jsx";
// Only mounts when a tile is clicked — deferred out of the profile chunk.
const MalRecommendationModal = lazy(
  () => import("./MalRecommendationModal.jsx"),
);

/**
 * 推 R2 — "You might also like". Clicking a cover opens a modal
 * that pulls the full MAL details and offers to add the series to
 * the library with a chosen number of owned volumes + price per
 * volume.
 *
 * Two layers of motion make the panel feel like a desk where
 * someone keeps drawing fresh recommendations from a deck:
 *
 *   1. **Static tilt grammar** — each visible tile carries an
 *      index-mod-4 rotation drawn from `TILTS`. The tiles look
 *      like polaroids tossed casually rather than a perfectly
 *      ruled grid. Hovering / focusing a tile straightens it to
 *      0deg + lifts it slightly, so the interactive affordance
 *      reads more cleanly than the resting state.
 *   2. **Auto-cycle** — when the rec pool exceeds the visible
 *      slot count, a `setInterval` advances a cursor every
 *      `CYCLE_MS`, swapping in fresh tiles from the pool with a
 *      brief stagger. Combined with `key={rec.mal_id}` the
 *      browser plays the existing `animate-fade-up` keyframe on
 *      each arrival without any extra animation library.
 *
 * The cycle pauses on `prefers-reduced-motion: reduce`, on hover
 * inside the section, and on focus inside the section — so the
 * user can read or tab through tiles without the carousel
 * pulling them away mid-action.
 */

const VISIBLE_COUNT = 8;
const CYCLE_MS = 9000;
const STAGGER_MS = 70;

// Per-index tilt in degrees, repeated across the grid via mod 4.
// Asymmetric on purpose — mirrored values would read as "deliberate
// pattern", these read as "casually placed".
const TILTS = [-2.5, 1.8, -1.4, 2.2];

export default function MalRecommendations() {
  const t = useT();
  const [selected, setSelected] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [paused, setPaused] = useState(false);
  const sectionRef = useRef(null);
  const {
    data: recs,
    isLoading,
    hasSources,
    error,
  } = useMalRecommendations({
    // Bumped from `limit: 8` so the auto-cycle has a fresh pool
    // to draw from — without enough recs the carousel has
    // nothing new to show and the section stays static.
    sourceLimit: 12,
    limit: 24,
  });

  // 推移 · The auto-cycle only runs when there's MORE than what's
  // visible — otherwise we'd just be re-rendering the same 8 tiles.
  const canCycle = (recs?.length ?? 0) > VISIBLE_COUNT;

  // 蛍幕 · Tab-visibility tracking. When the user switches tabs or
  // the page goes to a background-throttled state, we want the
  // carousel to pause its `setInterval` — not because the timer
  // itself is expensive, but because every tick re-renders the
  // section's tile slice + bumps its animations. Backgrounded
  // tabs already get throttled to 1 Hz by the browser, but we
  // can save the React work entirely with a hard pause.
  // `visibilitychange` fires on tab switch, window minimise, and
  // OS-level hides (PWA → home screen on mobile).
  const [tabVisible, setTabVisible] = useState(
    typeof document === "undefined" ? true : !document.hidden,
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  useEffect(() => {
    if (!canCycle || paused || !tabVisible) return;
    if (typeof window === "undefined") return;
    // Honour reduced-motion preferences — vestibular-sensitive
    // users get the static layout instead of a moving carousel.
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (mq?.matches) return;
    const id = setInterval(() => {
      setCursor((c) => (c + VISIBLE_COUNT / 2) % recs.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [canCycle, paused, tabVisible, recs?.length]);

  if (!hasSources) return null;

  // Compute the visible slice with wrap-around. When the cursor
  // sits near the end of the pool, the slice wraps back to the
  // start so the user never sees fewer than VISIBLE_COUNT tiles.
  const pool = recs ?? [];
  const visible = canCycle
    ? Array.from({ length: VISIBLE_COUNT }, (_, i) => pool[(cursor + i) % pool.length])
    : pool.slice(0, VISIBLE_COUNT);

  return (
    <section
      ref={sectionRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => {
        // Only un-pause when focus leaves the section entirely
        // (not when moving between tiles inside it).
        if (sectionRef.current && !sectionRef.current.contains(document.activeElement)) {
          setPaused(false);
        }
      }}
      className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur"
    >
      <div className="mb-4 flex items-baseline gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
          {t("recs.label")}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        {canCycle ? (
          // 廻 · Tiny indicator that the pool is rotating. Static
          // glyph (no spin animation) so reduced-motion users
          // still see the cue, but its presence signals the page
          // isn't "frozen" between cycles.
          <span
            aria-hidden="true"
            className="font-jp text-[10px] font-bold leading-none text-gold/80"
            title={t("recs.rotating")}
          >
            廻
          </span>
        ) : null}
      </div>
      <h2 className="font-display text-xl font-semibold italic text-washi">
        {t("recs.title")}
      </h2>
      <p className="mt-1 text-xs text-washi-muted">{t("recs.byline")}</p>

      {error === "jikan-rate-limit" && !recs.length && (
        <p className="mt-4 rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs text-washi-muted">
          {t("recs.rateLimited")}
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4">
        {isLoading && !recs.length
          ? [...Array(4)].map((_, i) => <Skeleton.Card key={i} />)
          : visible.map((rec, i) => {
              if (!rec) return null;
              const tilt = TILTS[i % TILTS.length];
              return (
                <button
                  // The mal_id key drives the fade-up re-mount when
                  // the cursor advances and a new rec rotates into
                  // this slot — see header comment.
                  key={rec.mal_id}
                  type="button"
                  onClick={() => setSelected(rec)}
                  className="group relative block w-full overflow-hidden rounded-lg border border-border bg-ink-2 text-left animate-fade-up transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:rotate-0 hover:border-hanko/55 hover:shadow-[0_22px_36px_-22px_rgba(176,30,42,0.45)] focus-visible:rotate-0 focus-visible:border-hanko"
                  style={{
                    transform: `rotate(${tilt}deg)`,
                    animationDelay: `${i * STAGGER_MS}ms`,
                  }}
                >
                  {rec.image_url ? (
                    <img
                      referrerPolicy="no-referrer"
                      src={rec.image_url}
                      alt=""
                      loading="lazy"
                      className="aspect-[2/3] w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div
                      className="grid aspect-[2/3] w-full place-items-center font-display text-3xl italic text-hanko/40"
                      title={t("badges.volume")}
                    >
                      巻
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-0 via-ink-0/80 to-transparent p-2">
                    <p className="line-clamp-2 font-display text-[11px] font-semibold leading-tight text-washi">
                      {rec.title}
                    </p>
                    <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-gold">
                      {t("recs.recommendedBy", { n: rec.sourceCount })}
                    </p>
                  </div>
                  {/* Hover hint */}
                  <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-hanko/90 text-washi opacity-0 shadow-lg transition group-hover:opacity-100">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </button>
              );
            })}
      </div>

      {selected && (
        <Suspense fallback={null}>
          <MalRecommendationModal
            open={Boolean(selected)}
            rec={selected}
            onClose={() => setSelected(null)}
          />
        </Suspense>
      )}
    </section>
  );
}
