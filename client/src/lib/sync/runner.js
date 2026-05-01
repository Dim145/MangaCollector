import { isFullyOnline, onConnectivityChange } from "../connectivity.js";
import { flushPendingLogout, hasPendingLogout } from "@/utils/auth.js";
import { pendingCount, syncOutbox } from "./outbox.js";

/*
 * Connectivity-gated sync runner.
 *
 * Owns the lifecycle of background flush triggers — the periodic safety
 * net, the visibilitychange catch-up, the connectivity-recover hook, and
 * the deferred startup probe. Kept singleton-guarded so React StrictMode's
 * double-invoke during dev doesn't double-subscribe.
 */

/**
 * When the server is reachable again, attempt any pending logout BEFORE
 * running data sync — so a stale session gets invalidated server-side
 * before anything else can refresh the cache.
 */
async function onServerRecover() {
  if (hasPendingLogout()) {
    await flushPendingLogout();
    // Don't sync after a successful logout — outbox was already cleared by
    // logout() locally, and sending requests with an invalidated cookie
    // would just produce 401s.
    return;
  }
  if (isFullyOnline()) syncOutbox();
}

// Module-level singleton guard: ensures we only subscribe to
// connectivity once and only start one interval, no matter how many
// times `installSyncRunner()` is called. React StrictMode
// double-invokes every effect in dev, so without this sentinel we'd
// end up with two connectivity listeners + two intervals firing in
// parallel — benign functionally but confusing in logs and a source
// of flaky test runs.
let _syncRunnerInstalled = false;
let _syncRunnerInterval = null;
let _syncRunnerUnsubscribe = null;

// Named so `removeEventListener` matches the same reference on uninstall.
function _syncRunnerVisibilityHandler() {
  if (typeof document === "undefined") return;
  if (document.visibilityState !== "visible") return;
  if (!isFullyOnline()) return;
  pendingCount().then((n) => {
    if (n > 0) syncOutbox();
  });
}

/**
 * Install sync runner.
 *
 * Unlike a naive `online`-event listener, we subscribe to the combined
 * connectivity watcher so a flush happens when EITHER:
 *   - the browser regains connectivity, or
 *   - the server itself comes back up after a crash/deploy.
 *
 * Returns a teardown function so callers (e.g. the React mount-effect
 * in `App.jsx`) can cleanly undo the install during hot-reload or
 * StrictMode's synthetic second mount.
 */
export function installSyncRunner() {
  if (_syncRunnerInstalled) return uninstallSyncRunner;
  _syncRunnerInstalled = true;

  _syncRunnerUnsubscribe = onConnectivityChange((e) => {
    if (e.detail?.serverReachable && navigator.onLine) {
      onServerRecover();
    }
  });

  // Slow safety-net for stuck outbox entries — only fires if the tab
  // is visible AND there's actually pending work. The visibilitychange
  // handler below covers the catch-up case when focus returns.
  _syncRunnerInterval = setInterval(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (!isFullyOnline()) return;
    if (hasPendingLogout()) {
      flushPendingLogout();
      return;
    }
    const n = await pendingCount();
    if (n > 0) syncOutbox();
  }, 60_000);

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", _syncRunnerVisibilityHandler);
  }

  // Deferred startup check — only schedules work if there IS work. Uses
  // requestIdleCallback so it never competes with the initial data render.
  const startup = async () => {
    if (hasPendingLogout()) {
      if (isFullyOnline()) flushPendingLogout();
      return;
    }
    const n = await pendingCount();
    if (n > 0 && isFullyOnline()) syncOutbox();
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(startup, { timeout: 2000 });
  } else {
    setTimeout(startup, 1000);
  }

  return uninstallSyncRunner;
}

/** Undo `installSyncRunner` — exposed for tests + StrictMode cleanup. */
export function uninstallSyncRunner() {
  if (_syncRunnerInterval) {
    clearInterval(_syncRunnerInterval);
    _syncRunnerInterval = null;
  }
  if (typeof _syncRunnerUnsubscribe === "function") {
    _syncRunnerUnsubscribe();
    _syncRunnerUnsubscribe = null;
  }
  if (typeof document !== "undefined") {
    document.removeEventListener(
      "visibilitychange",
      _syncRunnerVisibilityHandler,
    );
  }
  _syncRunnerInstalled = false;
}
