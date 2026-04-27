import { useCallback, useSyncExternalStore } from "react";

/**
 * Volumes view mode — "ledger" (default, dense edit grid) or "shelf"
 * (read-only cover wall). localStorage-backed.
 *
 * Uses `useSyncExternalStore` with a shared subscriber set so a write
 * wakes every consumer in the same tab. The browser's `storage` event
 * only fires across tabs, so without this hook a same-tab sibling
 * consumer would stay stuck on a stale value until reload.
 */

const STORAGE_KEY = "mc:volumes-view";
const VALID = new Set(["ledger", "shelf"]);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : "ledger";
  } catch {
    return "ledger";
  }
}

const subscribers = new Set();

function notify() {
  subscribers.forEach((cb) => cb());
}

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

function getServerSnapshot() {
  return "ledger";
}

export function useVolumesView() {
  const mode = useSyncExternalStore(subscribe, readStored, getServerSnapshot);

  const setMode = useCallback((next) => {
    const safe = VALID.has(next) ? next : "ledger";
    try {
      if (safe === "ledger") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, safe);
      }
    } catch {
      /* quota / private mode */
    }
    notify();
  }, []);

  return { mode, setMode };
}
