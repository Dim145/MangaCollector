/*
 * 設 · Runtime configuration fetched from the backend.
 *
 * GET /api/public-config returns the SDK config (Umami + error tracking
 * DSNs) that the operator set via env vars. Fetching it at boot — rather
 * than baking VITE_* vars into the bundle — means the same Docker image
 * can be redeployed across dev / staging / prod without a rebuild.
 *
 * Failure-mode contract (per the user spec):
 *   - Network down, backend 5xx, JSON parse error, timeout → return null
 *   - No console.error, no thrown exception, no UI signal
 *   - Caller treats a null return as "all integrations disabled"
 *
 * Why so quiet: this fetch runs BEFORE React mounts on a brand-new
 * visitor with no service-worker cache yet. Throwing or surfacing the
 * error would either blank the app or pop a banner the user can't act
 * on — neither is acceptable. The integrations are non-essential
 * polish; failing silent keeps the core app reachable.
 *
 * Once the backend has answered at least once, the service worker's
 * StaleWhileRevalidate rule on `/api/public-config` (see vite.config)
 * keeps subsequent boots instant and offline-tolerant.
 */

const ENDPOINT = "/api/public-config";
const TIMEOUT_MS = 1500;

/**
 * Fetches the public config payload. Always resolves; never rejects.
 * Returns the parsed payload on success, `null` on any failure.
 */
export async function fetchPublicConfig() {
  if (typeof fetch === "undefined") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      // No credentials — endpoint is public, sending the session cookie
      // would only complicate the SW caching layer (vary on cookies).
      credentials: "omit",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return normalize(json);
  } catch {
    // Silent — see module docs for the rationale.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Defensive shape coercion. The backend already enforces the mutex on
 * frontend DSNs, but a stale SW cache from a previous deploy could in
 * principle return a payload with an unexpected shape. We don't error
 * in that case — we just disable error tracking and let the next online
 * boot refresh the cache with a valid payload.
 *
 * (Umami isn't carried in this payload — it's injected directly into
 * `index.html` at container startup, see `lib/analytics.js`.)
 */
function normalize(payload) {
  if (!payload || typeof payload !== "object") return null;
  const errorTracking =
    payload.errorTracking && typeof payload.errorTracking.dsn === "string"
      ? payload.errorTracking
      : null;
  return { errorTracking };
}
