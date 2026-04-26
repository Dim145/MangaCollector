import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { getCurrentSeason, isInSeasonTransition } from "@/lib/season.js";
import { useAtmosphere } from "@/hooks/useAtmosphere.js";

/**
 * 季節 · Ambient seasonal atmosphere — V2 (optimised + gated).
 *
 * A thin background layer that drifts a small swarm of season-tinted
 * particles across the viewport. The intent is *easter-egg subtle*:
 * a user landing in late September notices a faint scatter of golden
 * leaves the day of the equinox, not a constant snow globe.
 *
 * ## V1 → V2 changes
 *
 * V1 ran the layer continuously across all pages year-round, with
 * 9-14 particles per season and `filter: blur(…)` on every particle.
 * That measured visibly on the GPU compositor (a popular cause of
 * jank on laptops with iGPUs) and there was no way for the user to
 * opt out. V2 fixes all three issues:
 *
 * 1. **Reduced cost per particle**:
 *    - Particle counts cut roughly in half (5–7 per season).
 *    - `filter: blur()` removed entirely from every season variant
 *      (was the largest single contributor — `filter` triggers a
 *      separate compositor pass per particle per frame).
 *    - Animation durations lengthened (35-50 s vs 14-26 s) so the
 *      compositor processes about half as many frames per cycle.
 *    - Box-shadow on the firefly variant downgraded to a single
 *      ring (was double).
 *
 * 2. **User control** via `useAtmosphere()` — localStorage-backed
 *    per-device toggle exposed in Settings. Default ON; users opt
 *    out by un-ticking the box.
 *
 * 3. **Conditional rendering** — even with the toggle ON, the layer
 *    only appears when the visit semantically benefits from it:
 *    - **Always on the public landing** (path `/`) — the marketing
 *      page is short-lived per visitor, the layer adds atmosphere
 *      to a first-impression surface.
 *    - **In-app pages**: only during the **7-day window around an
 *      equinox or solstice** (J−3 → J+3). The visual cue
 *      "the season is turning" is strongest when the season is
 *      *actually* turning. The rest of the year, the page reverts
 *      to its standard non-animated chrome.
 *
 * 4. **Background tab pause** — when the page is hidden
 *    (`document.visibilityState === "hidden"`), the whole layer is
 *    unmounted so no compositor cycles are spent painting particles
 *    nobody can see. It re-mounts when the tab regains focus.
 *
 * ## Net effect
 *
 * Median user pays the cost only on the public landing OR for ~28
 * calendar days per year on app pages, with a smaller swarm and no
 * `filter: blur` — likely a 70-80% reduction in measured GPU time vs
 * V1 across a full year, while preserving the moments where the
 * effect is most narratively strong (the actual seasonal turn).
 */

/**
 * Per-season particle counts. Halved from V1 (was 11/9/13/14).
 * Tuned to stay below the perceptual "noise floor" — five drifting
 * shapes at half-second offsets read as ambient scatter; a dozen
 * read as weather.
 */
const COUNT = {
  spring: 5,
  summer: 4,
  autumn: 6,
  winter: 7,
};

function makeParticles(season) {
  const count = COUNT[season] ?? 0;
  if (count === 0) return [];
  let seed = 0;
  for (let i = 0; i < season.length; i++) seed = (seed * 31 + season.charCodeAt(i)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const arr = [];
  for (let i = 0; i < count; i++) {
    const laneCenter = (i + 0.5) / count;
    const jitter = (rand() - 0.5) * 0.35;
    const left = Math.max(0.02, Math.min(0.98, laneCenter + jitter / count));
    arr.push({
      x: left,
      scale: 0.7 + rand() * 0.6,
      delay: rand(),
      // V1 ran 14-26s. V2 runs 30-48s — same visual wandering speed
      // but ~half the compositor frames per particle per second.
      duration: 30 + rand() * 18,
      rot: Math.floor(rand() * 360),
    });
  }
  return arr;
}

/**
 * Decide whether the layer should be active given the current page,
 * date, and user preference. Kept as a pure function so the gate can
 * be unit-tested independently of the React render pipeline.
 *
 * `pathname` comes from React Router; `now` is injectable for tests.
 */
function shouldRender(pathname, now = new Date()) {
  // The public landing always gets it — it's the marketing surface,
  // a transient visit, and visually the place where atmosphere helps
  // most. Any other path falls under the transition-window rule.
  if (pathname === "/") return true;
  return isInSeasonTransition(now);
}

export default function SeasonAtmosphere() {
  const { enabled } = useAtmosphere();
  const { pathname } = useLocation();

  // Pause when the tab is hidden — re-mounts when focus returns.
  // Using state rather than CSS `animation-play-state` so when the
  // tab spends an hour in the background we genuinely free the
  // compositor layers (not just stop the keyframe progression).
  const [tabVisible, setTabVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const handler = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  const season = getCurrentSeason();
  // Memoised on (season). Path/date changes don't reshuffle the
  // scatter — the user gets the same arrangement for the entire
  // visit, no jitter on navigation.
  const particles = useMemo(() => makeParticles(season), [season]);

  if (!enabled) return null;
  if (!tabVisible) return null;
  if (!shouldRender(pathname)) return null;
  if (particles.length === 0) return null;

  const seasonClass =
    {
      spring: "atmo-spring",
      summer: "atmo-summer",
      autumn: "atmo-autumn",
      winter: "atmo-winter",
    }[season] ?? "";

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${seasonClass}`}
    >
      {particles.map((p, i) => (
        <span
          key={i}
          className="atmo-particle"
          style={{
            left: `${(p.x * 100).toFixed(2)}vw`,
            "--scale": p.scale.toFixed(2),
            "--delay": `${(p.delay * p.duration).toFixed(2)}s`,
            "--duration": `${p.duration.toFixed(2)}s`,
            "--rot": `${p.rot}deg`,
          }}
        />
      ))}
    </div>
  );
}
