/*
 * 監 · Frontend error tracking — Sentry SDK init.
 *
 * The DSN can target the official Sentry cloud, a self-hosted Sentry
 * instance, or a Bugsink instance — all three speak the same wire
 * protocol. The choice (and mutual exclusion) is enforced server-side
 * by `observability::frontend_config()`; this module trusts the
 * payload it gets from `GET /api/public-config`.
 *
 * Performance tracing + session replay are opt-in operator-side via
 * `FRONTEND_SENTRY_TRACES_SAMPLE_RATE` and `FRONTEND_SENTRY_REPLAY` —
 * both default off so a hobby PWA doesn't pay for features it won't use.
 *
 * Init is a no-op when called with a falsy `config` (the SPA passes
 * `null` when the backend's payload had `errorTracking: null`, OR when
 * the public-config fetch failed silently — see `publicConfig.js`).
 */

import * as Sentry from "@sentry/browser";

export function initErrorTracking(config) {
  if (!config) return;

  const integrations = [];
  const tracesSampleRate = clampSampleRate(config.tracesSampleRate);
  if (tracesSampleRate > 0) {
    integrations.push(Sentry.browserTracingIntegration());
  }
  if (config.replay) {
    integrations.push(
      // `maskAllText: true` is the GDPR-safe default — replays show
      // the page structure but never the user's manga titles, notes,
      // or PII. Operator can flip it via a follow-up integration
      // override if they really want raw text in replays.
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    );
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment ?? "production",
    release: config.release ?? undefined,
    integrations,
    tracesSampleRate,
    replaysSessionSampleRate: config.replay ? 0.1 : 0,
    replaysOnErrorSampleRate: config.replay ? 1.0 : 0,
    sendDefaultPii: false,
  });

  console.info(
    `[observability] error tracking enabled · provider=${config.provider} · traces=${tracesSampleRate} · replay=${Boolean(config.replay)}`,
  );
}

function clampSampleRate(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}
