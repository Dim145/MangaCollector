import { useCallback, useEffect, useState } from "react";

/**
 * Toggle for the seasonal-atmosphere particle layer. localStorage-
 * backed, per-device, with cross-tab sync so flipping it in Settings
 * propagates to every other open tab.
 */

const STORAGE_KEY = "mc:atmosphere";

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function useAtmosphere() {
  const [enabled, setEnabledState] = useState(() => readStored());

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
      if (next === false) {
        localStorage.setItem(STORAGE_KEY, "false");
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* quota / private mode */
    }
    setEnabledState(Boolean(next));
  }, []);

  return { enabled, setEnabled };
}
