import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_DENSITY, isDensity } from "@/lib/gridDensity.js";

/**
 * 密 · How tightly the library grid packs — "comfortable" (the default)
 * or "dense". localStorage-backed, same shared-subscriber shape as
 * `useVolumesView`: the browser's `storage` event only fires across
 * tabs, so a same-tab sibling would otherwise stay on a stale value.
 */

const STORAGE_KEY = "mc:grid-density";

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isDensity(v) ? v : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

const subscribers = new Set();

function subscribe(callback) {
  subscribers.add(callback);
  const storageHandler = (event) => {
    if (event.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    subscribers.delete(callback);
    window.removeEventListener("storage", storageHandler);
  };
}

const getServerSnapshot = () => DEFAULT_DENSITY;

export function useGridDensity() {
  const density = useSyncExternalStore(
    subscribe,
    readStored,
    getServerSnapshot,
  );

  const setDensity = useCallback((next) => {
    const value = isDensity(next) ? next : DEFAULT_DENSITY;
    try {
      if (value === DEFAULT_DENSITY) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* quota / private mode */
    }
    subscribers.forEach((cb) => cb());
  }, []);

  return { density, setDensity };
}
