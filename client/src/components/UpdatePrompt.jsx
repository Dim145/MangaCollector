import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useT } from "@/i18n/index.jsx";

/**
 * 更 Kō · Service-worker update prompt.
 *
 * Detects when a new build is available on the server and surfaces
 * a quiet, non-blocking notification at the bottom-right of the
 * viewport. The user reloads at their own pace; they're never
 * forced to interrupt what they're doing.
 *
 * How detection works:
 *   1. The browser revisits the SPA → workbox checks for an updated
 *      service worker (~hourly automatic cycle, also on every navigate
 *      via the SW lifecycle).
 *   2. When a new SW finishes installing, vite-plugin-pwa fires
 *      `onNeedRefresh` → we flip `needRefresh` true.
 *   3. The banner appears with a "Recharger" CTA. Clicking calls
 *      `updateServiceWorker(true)` which:
 *        a. Posts SKIP_WAITING to the new SW so it activates
 *        b. Reloads the page once activation completes
 *      `cleanupOutdatedCaches: true` (vite.config.js) purges old
 *      workbox buckets at activation time — the user lands on a
 *      clean cache without us having to manually nuke anything.
 *
 * We also expose a manual "check for update" via the periodic
 * registration heartbeat below so a long-lived tab (e.g. left
 * open overnight) catches a deploy that happened in the meantime.
 */
export default function UpdatePrompt() {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);

  // Held in a ref so the unmount-cleanup `useEffect` below clears
  // the timer regardless of when `onRegisteredSW` fired (it runs
  // out-of-band relative to React's render cycle). Using
  // `beforeunload` for cleanup misses bfcache navigations and HMR
  // remounts, leaking parallel intervals.
  const updateTimerRef = useRef(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // 定期 · Long-lived tab heartbeat — re-check the SW
      // registration every 30 minutes so a user who left the
      // app open notices a deploy without having to manually
      // refocus the tab. The browser's own update interval
      // varies (~24h max), so an explicit poll catches
      // intermediate deploys.
      if (!registration) return;
      // Drop any timer left over from a previous registration.
      if (updateTimerRef.current) clearInterval(updateTimerRef.current);
      const interval = 30 * 60 * 1000;
      updateTimerRef.current = setInterval(() => {
        // Skip if the user is offline — `update()` would just
        // 504/timeout, no point burning the cycle.
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          return;
        }
        registration.update().catch(() => {
          /* network blip — try again next interval */
        });
      }, interval);
    },
  });

  // Mount-scoped cleanup: clears the heartbeat interval whenever
  // the component unmounts (route change in tests, HMR, bfcache
  // restore). Empty deps — the timer id lives in a ref.
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
        updateTimerRef.current = null;
      }
    };
  }, []);

  // Reset the dismiss flag when a brand-new update lands. Without
  // this, dismissing once would silently suppress every subsequent
  // deploy until the user reloads the tab manually.
  useEffect(() => {
    if (needRefresh) setDismissed(false);
  }, [needRefresh]);

  if (!needRefresh || dismissed) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t("update.aria")}
      className="update-prompt animate-fade-up fixed bottom-4 right-4 z-[100] max-w-[calc(100vw-2rem)] sm:max-w-md"
    >
      <div className="relative overflow-hidden rounded-lg border border-gold/55 bg-ink-1/95 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85)] backdrop-blur">
        {/* Decorative torn gold corner — same vocabulary as the
            Inei capture modal, signals "fresh / new" via the gold
            leaf rather than a red urgency cue. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-10 w-10 bg-gradient-to-br from-gold/40 via-gold/15 to-transparent"
          style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}
        />
        {/* Paper noise overlay */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
          }}
        />

        <div className="relative flex items-start gap-3 p-4">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-gold/50 bg-gold/10 font-jp text-base font-bold text-gold shadow-inner"
            style={{ transform: "rotate(-4deg)" }}
          >
            更
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold">
              {t("update.kicker")}
            </p>
            <h3 className="mt-1 font-display text-base font-semibold italic leading-tight text-washi">
              {t("update.title")}
            </h3>
            <p className="mt-1 font-display text-[13px] italic leading-snug text-washi-muted">
              {t("update.body")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => updateServiceWorker(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-0 transition hover:bg-gold-bright"
              >
                <span aria-hidden="true" className="font-jp text-[12px] not-italic">
                  新
                </span>
                {t("update.reloadAction")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDismissed(true);
                  setNeedRefresh(false);
                }}
                className="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-washi-muted transition hover:text-washi"
              >
                {t("update.laterAction")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
