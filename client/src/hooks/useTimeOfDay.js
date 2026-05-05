import { useEffect, useState } from "react";

/**
 * 時 · Time-of-day hook + DOM applier.
 *
 * The page tonality drifts subtly with the local hour: a touch
 * of cool blue at dawn, neutral mid-morning, warmer amber as the
 * afternoon turns, golden orange at dusk, indigo through the
 * night. The drift is *additive* on top of the seasonal palette
 * — it doesn't override the season's colours, just whispers a
 * second tint via a fresh CSS variable (`--tod-haze-tone`).
 *
 * The actual styling lives in `styles/index.css` under the
 * `:root[data-tod="…"]` selectors; this hook is only responsible
 * for keeping that attribute in sync with wall-clock time.
 *
 * Cadence:
 *   • Apply on mount (no anti-FOUC inline script — the drift is
 *     subtle enough that one frame of "wrong time of day" is
 *     visually invisible against the existing season + accent
 *     palette).
 *   • Refresh every 5 minutes — the boundaries between brackets
 *     are 30 min wide so 5 min granularity is overkill in the
 *     boring case but means the user never sits 30+ min on a
 *     stale tone if they leave the tab open.
 *   • Refresh on `visibilitychange` so a phone user who opens
 *     the app at noon, closes it, and reopens at 19:00 sees the
 *     dusk tint immediately rather than waiting up to 5 min.
 *
 * The six brackets are tuned around French / continental Europe
 * sunrise/sunset windows — soft enough to feel right anywhere
 * temperate, rather than locking to astronomical twilight which
 * would require geolocation. Boundaries:
 *
 *   night     · 20:00 → 04:30
 *   dawn      · 04:30 → 07:30
 *   morning   · 07:30 → 11:00
 *   noon      · 11:00 → 14:00
 *   afternoon · 14:00 → 17:30
 *   dusk      · 17:30 → 20:00
 */

const REFRESH_MS = 5 * 60 * 1000;

/** Map a 0..24 fractional hour to a TOD bracket name. */
export function todFromHour(h) {
  if (h < 4.5) return "night";
  if (h < 7.5) return "dawn";
  if (h < 11) return "morning";
  if (h < 14) return "noon";
  if (h < 17.5) return "afternoon";
  if (h < 20) return "dusk";
  return "night";
}

export function todFromDate(d = new Date()) {
  return todFromHour(d.getHours() + d.getMinutes() / 60);
}

function applyToDom(tod) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-tod", tod);
}

/**
 * Mount-only hook: resolves the current TOD, writes it to
 * `data-tod` on `<html>`, and refreshes on a 5-min cadence + on
 * `visibilitychange`. Returns the current TOD string in case a
 * caller wants to render time-aware copy elsewhere.
 *
 * Idempotent on multiple mounts (every call writes the same
 * attribute) — `applyToDom` is a setter; concurrent callers race
 * harmlessly to the same value.
 */
export function useTimeOfDay() {
  const [tod, setTod] = useState(() => todFromDate());

  useEffect(() => {
    const apply = () => {
      const next = todFromDate();
      applyToDom(next);
      setTod((prev) => (prev === next ? prev : next));
    };
    apply();

    const interval = setInterval(apply, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) apply();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return tod;
}
