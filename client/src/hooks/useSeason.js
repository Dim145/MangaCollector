import { useCallback, useEffect, useState } from "react";

/**
 * 季節 · Seasonal theme hook.
 *
 * The ambient background glows are tinted by the current Japanese
 * season. The hook exposes:
 *   • `preference` — user's explicit choice: "auto" | "neutral" |
 *     "spring" | "summer" | "autumn" | "winter"
 *   • `current` — resolved season actually applied (null for neutral)
 *   • `setPreference(next)` — persists + reflects immediately
 *
 * The initial DOM attribute is already set by the inline script in
 * index.html, so there's no flash. This hook keeps React's view of
 * the world in sync and reacts to preference changes.
 */

const STORAGE_KEY = "mc:season";

export const SEASONS = ["spring", "summer", "autumn", "winter"];
export const PREFERENCES = [
  "auto",
  "spring",
  "summer",
  "autumn",
  "winter",
  "neutral",
];

/** Month (1..12) → season name. */
export function seasonFromMonth(month) {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/** Resolve a preference string to the concrete season to apply, or null
 *  for "neutral" (no data-season attribute). */
export function resolveSeason(preference) {
  if (preference === "neutral") return null;
  if (SEASONS.includes(preference)) return preference;
  // "auto" or unknown → derive from today's month.
  return seasonFromMonth(new Date().getMonth() + 1);
}

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && PREFERENCES.includes(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

function applyToDom(season) {
  const root = document.documentElement;
  if (season) {
    root.setAttribute("data-season", season);
  } else {
    root.removeAttribute("data-season");
  }
}

export function useSeason() {
  const [preference, setPreferenceState] = useState(() => readStored());

  // On first mount, make sure the DOM matches our React state — in
  // case the inline bootstrap disagreed (shouldn't, but belt-and-
  // braces for SSR or edge browsers with weird localStorage access).
  useEffect(() => {
    applyToDom(resolveSeason(preference));
  }, [preference]);

  const setPreference = useCallback((next) => {
    if (!PREFERENCES.includes(next)) return;
    try {
      if (next === "auto") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      /* quota / private mode — the runtime state still updates below */
    }
    setPreferenceState(next);
  }, []);

  const current = resolveSeason(preference);

  return { preference, current, setPreference };
}
