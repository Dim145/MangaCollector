/*
 * 計 · Privacy-friendly analytics — Umami script injection.
 *
 * Config arrives via `window.__APP_CONFIG__.umami`, populated by the
 * inline `<script>` block at the top of `index.html` whose
 * `${FRONTEND_UMAMI_*}` placeholders are resolved by the nginx
 * container's envsubst entrypoint (see `client/docker-entrypoint.sh`).
 *
 * Runtime config — same image redeployed across dev/staging/prod with
 * different Umami targets, no rebuild required. Synchronous availability
 * (no fetch) means Umami can register the very first pageview without
 * the round-trip blind spot a `/api/public-config` fetch would impose.
 *
 * Skipped silently in three cases:
 *   1. Operator hasn't set the env vars → empty strings → no-op.
 *   2. Vite dev server (no envsubst pass) → literal `${...}`
 *      placeholders → detected via the `${` prefix → no-op. Lets the
 *      dev experience stay clean without manual env wiring locally.
 *   3. SSR / `document` undefined.
 *
 * V1 scope: pageviews only. Umami's official script auto-hooks
 * `history.pushState` / `popstate`, so React Router navigations are
 * tracked without any extra wiring. Custom event instrumentation
 * (`umami.track('volume_owned', ...)`) is deferred to V2.
 */

export function initAnalytics() {
  if (typeof document === "undefined") return;

  const cfg = (typeof window !== "undefined" && window.__APP_CONFIG__?.umami) || null;
  if (!cfg) return;

  const scriptUrl = cfg.scriptUrl ?? "";
  const websiteId = cfg.websiteId ?? "";

  if (!scriptUrl || !websiteId) return;
  // Catch the dev-server / un-templated case — `index.html` was served
  // verbatim with the placeholders intact.
  if (scriptUrl.startsWith("${") || websiteId.startsWith("${")) return;

  // Idempotency: protect against accidental double-init in dev hot-reload.
  // Querying by data attribute is enough — we never inject more than one.
  if (document.querySelector('script[data-umami-injected="1"]')) return;

  const script = document.createElement("script");
  script.defer = true;
  script.src = scriptUrl;
  script.dataset.websiteId = websiteId;
  script.dataset.umamiInjected = "1";
  document.head.appendChild(script);
}
