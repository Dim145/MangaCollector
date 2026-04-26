import { useCallback, useEffect, useState } from "react";

/**
 * 季節 · Seasonal-atmosphere preference.
 *
 * Mirrors the shape of `useSeason` (localStorage-backed, same prefix)
 * because this is also a purely-decorative client-side setting that
 * doesn't deserve a server round-trip:
 *   - It's per-device (a user might want it on at home, off at work
 *     where the page sits in a background tab all day).
 *   - It tunes a visual that has zero data implication.
 *   - Loosing the setting on browser cleanup is acceptable — the
 *     default reverts to the "yes, show it" branch and the user
 *     re-toggles if they care.
 *
 * The hook listens for `storage` events so when the toggle is changed
 * in the Settings tab, every other open tab picks it up immediately.
 */

const STORAGE_KEY = "mc:atmosphere";

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    // Default ON when never set. Off only when the user has
    // explicitly opted out.
    return v !== "false";
  } catch {
    return true;
  }
}

export function useAtmosphere() {
  const [enabled, setEnabledState] = useState(() => readStored());

  // Cross-tab sync — if the user toggles the option in Settings on
  // one tab, all the others react.
  useEffect(() => {
    const handler = (event) => {
      if (event.key === STORAGE_KEY) {
        setEnabledState(readStored());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setEnabled = useCallback((next) => {
    try {
      // Persist `false` explicitly; remove the key when going back
      // to the default `true` so the storage stays clean.
      if (next === false) {
        localStorage.setItem(STORAGE_KEY, "false");
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* quota / private mode — runtime state still updates */
    }
    setEnabledState(Boolean(next));
  }, []);

  return { enabled, setEnabled };
}
