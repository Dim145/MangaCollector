import { useEffect, useRef, useState } from "react";
import { usePendingCount } from "@/hooks/usePendingCount.js";
import {
  getServerReachable,
  onConnectivityChange,
} from "@/lib/connectivity.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 沈黙 · Quiet window before a "syncing" / "server unreachable" state
 * earns a banner. Mutations on a healthy connection complete in
 * 50-300ms; without a debounce the banner flickers in and out every
 * time the user clicks Enregistrer because pending goes 0 → 1 → 0
 * inside a single round-trip. 800ms keeps the banner from triggering
 * on routine saves while still surfacing genuinely slow / failed syncs
 * within a perceptible delay.
 *
 * Genuine offline at MOUNT (browser already disconnected when the
 * component renders) bypasses the debounce — we don't want a user who
 * lands on the app without network to wait 800ms before seeing the
 * "you're offline" banner.
 */
const BANNER_DEBOUNCE_MS = 800;

function useConnectivityDetail() {
  const [state, setState] = useState(() => ({
    browserOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    serverReachable: getServerReachable(),
  }));

  useEffect(() => {
    const refresh = () =>
      setState({
        browserOnline: navigator.onLine,
        serverReachable: getServerReachable(),
      });
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    const off = onConnectivityChange(refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      off();
    };
  }, []);

  return state;
}

export default function OfflineBanner() {
  const { browserOnline, serverReachable } = useConnectivityDetail();
  const pending = usePendingCount();
  const online = browserOnline && serverReachable;
  const t = useT();

  // Whether the banner SHOULD be shown given current state. The actual
  // visibility flag below debounces transitions into the "show" state.
  const shouldShow = !online || pending > 0;

  // Initial visibility = shouldShow, so a user landing on the app
  // already offline sees the banner immediately. Subsequent transitions
  // run through the debounce.
  const [visible, setVisible] = useState(shouldShow);
  // Track whether we've ever seen a hide → show transition; used to
  // decide whether to debounce or to snap-show on mount.
  const everToggledRef = useRef(false);

  useEffect(() => {
    if (!shouldShow) {
      // Hide immediately — sync just completed or connectivity recovered.
      setVisible(false);
      everToggledRef.current = true;
      return;
    }

    // First render with shouldShow=true (cold offline mount): the
    // useState init already set visible=true; nothing to schedule.
    if (!everToggledRef.current && visible) {
      everToggledRef.current = true;
      return;
    }

    // shouldShow just flipped false → true (e.g. user clicked Save and
    // an outbox row was queued). Wait BANNER_DEBOUNCE_MS before showing
    // — if pending drops back to 0 within that window (the normal
    // healthy-connection path) the cleanup cancels the timer and the
    // banner never appears.
    const timer = setTimeout(() => {
      setVisible(true);
      everToggledRef.current = true;
    }, BANNER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `visible` is intentionally read but not a dep — this effect only
    // re-runs on `shouldShow` changes; reading the live `visible` for
    // the cold-mount branch is fine since useState's initialiser already
    // mirrored shouldShow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow]);

  if (!visible) return null;

  const cause = !browserOnline
    ? "offline"
    : !serverReachable
      ? "server"
      : "syncing";

  const label =
    cause === "offline"
      ? t("offline.offline")
      : cause === "server"
        ? t("offline.serverUnreachable")
        : null;

  const bg =
    cause === "syncing"
      ? "linear-gradient(90deg, oklch(0.82 0.13 78 / 0.15), oklch(0.6 0.22 25 / 0.1))"
      : cause === "server"
        ? "linear-gradient(90deg, oklch(0.82 0.13 78 / 0.2), oklch(0.6 0.22 25 / 0.15))"
        : "linear-gradient(90deg, oklch(0.6 0.22 25 / 0.2), oklch(0.48 0.2 25 / 0.15))";

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-30 border-b border-border/70 backdrop-blur-md animate-slide-down"
      style={{ background: bg }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-1.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {cause === "syncing" ? (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
            </span>
          ) : (
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                cause === "server" ? "bg-gold" : "bg-hanko-bright"
              }`}
            />
          )}
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-washi">
            {cause === "syncing" ? (
              <>
                {/* Pluralised via t() — the raw "change"/"changes"
                    English literals that used to sit here broke the
                    banner for fr/es users while "Syncing" around them
                    was correctly translated. */}
                {t(
                  pending === 1
                    ? "offline.syncingChanges"
                    : "offline.syncingChangesPlural",
                  { n: pending },
                )}
              </>
            ) : cause === "server" ? (
              <>
                {label} —{" "}
                {pending > 0 ? (
                  <span className="font-sans font-semibold text-washi">
                    {t(
                      pending === 1
                        ? "offline.changesQueuedOne"
                        : "offline.changesQueuedMany",
                      { n: pending },
                    )}
                  </span>
                ) : (
                  t("offline.willRetry")
                )}
              </>
            ) : (
              <>
                {label} —{" "}
                {pending > 0 ? (
                  <span className="font-sans font-semibold text-washi">
                    {t(
                      pending === 1
                        ? "offline.changesQueuedOne"
                        : "offline.changesQueuedMany",
                      { n: pending },
                    )}
                  </span>
                ) : (
                  t("offline.willSync")
                )}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
