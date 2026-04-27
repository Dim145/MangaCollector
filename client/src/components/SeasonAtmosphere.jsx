import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { getCurrentSeason, isInSeasonTransition } from "@/lib/season.js";
import { useAtmosphere } from "@/hooks/useAtmosphere.js";

/**
 * Drifts a small swarm of season-tinted particles in the background.
 * Renders only on the public landing or during the 7-day window
 * around an equinox or solstice (J−3 → J+3); the rest of the year the
 * page reverts to its standard non-animated chrome. Auto-unmounts
 * when the tab is hidden so backgrounded tabs don't burn GPU time.
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
      duration: 30 + rand() * 18,
      rot: Math.floor(rand() * 360),
    });
  }
  return arr;
}

function shouldRender(pathname, now = new Date()) {
  if (pathname === "/") return true;
  return isInSeasonTransition(now);
}

export default function SeasonAtmosphere() {
  const { enabled } = useAtmosphere();
  const { pathname } = useLocation();

  const [tabVisible, setTabVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const handler = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  const season = getCurrentSeason();
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
