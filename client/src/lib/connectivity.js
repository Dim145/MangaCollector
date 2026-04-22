import axios from "@/utils/axios.js";

/*
 * Connectivity watcher — decides whether the app can actually reach the
 * backend, not just whether the machine has a network interface.
 *
 * Signals combined:
 *   1. `navigator.onLine`        → browser-level link state
 *   2. server reachability       → axios interceptor + periodic probe to
 *                                  `/auth/provider` (a public, cheap endpoint)
 *
 * Rules:
 *   - ANY successful response (2xx/3xx)  → server reachable
 *   - 4xx                                → server reachable (it answered)
 *   - 5xx / network error / timeout      → server unreachable
 *
 * The combined state is used by `useOnline()` and the sync engine so the
 * app reacts to deploy-time downtime, crashes or firewall blocks the same
 * way it reacts to a broken Wi-Fi.
 */

const PROBE_URL = "/auth/provider";
const PROBE_TIMEOUT_MS = 5000;
const POLL_INTERVAL_UP_MS = 120_000; // 2 min when healthy (silent degradation)
const POLL_INTERVAL_DOWN_MS = 10_000; // 10 s when down (fast recovery)

const CONNECTIVITY_EVENT = "mc:connectivity-changed";

let serverReachable = true;
let probeInFlight = null;

function setReachable(next) {
  if (serverReachable === next) return;
  serverReachable = next;
  window.dispatchEvent(
    new CustomEvent(CONNECTIVITY_EVENT, { detail: { serverReachable } }),
  );
}

/** Observe changes to the combined reachability state. */
export function onConnectivityChange(handler) {
  window.addEventListener(CONNECTIVITY_EVENT, handler);
  return () => window.removeEventListener(CONNECTIVITY_EVENT, handler);
}

/** Current server reachability (boolean). */
export function getServerReachable() {
  return serverReachable;
}

/** True if the browser is online AND the server answers. */
export function isFullyOnline() {
  return Boolean(navigator.onLine) && serverReachable;
}

/**
 * Detect the SPA-fallback trap: when the reverse proxy loses the backend
 * route (container down, deploy in progress…) and the request falls through
 * to the static client nginx, we get `200 OK` + `text/html` for `/auth/*`
 * or `/api/*`. That's a lie — the backend is actually unreachable. Any
 * genuine backend response is JSON (or plain text for the legacy health
 * endpoint), never HTML.
 */
function looksLikeBackendResponse(headers) {
  const ct = headers?.["content-type"] ?? "";
  // axios normalizes header names to lowercase, but Vite dev proxy might
  // keep mixed case — check both defensively.
  const ctAny = ct || headers?.["Content-Type"] || "";
  return (
    ctAny.includes("application/json") ||
    ctAny.includes("text/plain") ||
    ctAny.includes("application/problem+json")
  );
}

/**
 * Ping the server explicitly. Deduped — concurrent callers await the same
 * in-flight request.
 */
export function probeServer() {
  if (!navigator.onLine) {
    setReachable(false);
    return Promise.resolve(false);
  }
  if (probeInFlight) return probeInFlight;

  probeInFlight = axios
    .get(PROBE_URL, { timeout: PROBE_TIMEOUT_MS })
    .then((res) => {
      if (!looksLikeBackendResponse(res.headers)) {
        // 200 OK but served HTML → SPA fallback, backend is actually down.
        setReachable(false);
        return false;
      }
      setReachable(true);
      return true;
    })
    .catch((err) => {
      const status = err?.response?.status;
      if (
        status != null &&
        status < 500 &&
        looksLikeBackendResponse(err.response?.headers)
      ) {
        // server answered — it IS up, just didn't like this request
        setReachable(true);
        return true;
      }
      setReachable(false);
      return false;
    })
    .finally(() => {
      probeInFlight = null;
    });

  return probeInFlight;
}

/**
 * Install interceptors + polling. Call once at app start.
 */
export function installConnectivityWatcher() {
  // Piggyback on ambient traffic: whenever a request succeeds or explicitly
  // fails with a 4xx, we know the server is reachable — AS LONG AS the
  // response actually came from the backend. A 200 with `text/html` is the
  // SPA-fallback tell-tale: reverse proxy lost the backend route and we're
  // looking at `index.html`, not a real API response. Treat that as "down".
  axios.interceptors.response.use(
    (res) => {
      if (looksLikeBackendResponse(res.headers)) {
        setReachable(true);
      } else {
        setReachable(false);
      }
      return res;
    },
    (err) => {
      const status = err?.response?.status;
      if (status == null) {
        // Network error, CORS, timeout — no response reached us.
        setReachable(false);
      } else if (status >= 500) {
        setReachable(false);
      } else if (!looksLikeBackendResponse(err.response?.headers)) {
        // 4xx but HTML body → SPA fallback, not the real backend.
        setReachable(false);
      } else {
        // Server responded with 4xx; it's up, just refused this request.
        setReachable(true);
      }
      return Promise.reject(err);
    },
  );

  // Browser-level events reflect the link itself
  window.addEventListener("online", () => {
    // Re-probe immediately — the browser might be connected but not yet
    // routing to our origin.
    probeServer();
  });
  window.addEventListener("offline", () => {
    setReachable(false);
  });

  // Adaptive polling. Aggressive only when we know we're down, so recovery
  // is fast; while we're up we poll lazily (the ambient axios traffic is
  // enough to keep the signal fresh). No eager probe on start — initial
  // page-load requests (e.g. `/auth/user`, `/api/user/settings`) feed the
  // interceptor and set the state from their real responses.
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    const delay = serverReachable ? POLL_INTERVAL_UP_MS : POLL_INTERVAL_DOWN_MS;
    timer = setTimeout(async () => {
      await probeServer();
      schedule();
    }, delay);
  };

  onConnectivityChange(schedule);
  schedule();

  if (!navigator.onLine) setReachable(false);
}
