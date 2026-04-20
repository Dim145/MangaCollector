import { useEffect, useState } from "react";
import { usePendingCount } from "@/hooks/usePendingCount.js";
import {
  getServerReachable,
  onConnectivityChange,
} from "@/lib/connectivity.js";
import { useT } from "@/i18n/index.jsx";

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

  if (online && pending === 0) return null;

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
                {t("offline.syncing")}{" "}
                <span className="font-sans font-semibold text-gold">
                  {pending}
                </span>{" "}
                {pending === 1 ? "change" : "changes"}
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
