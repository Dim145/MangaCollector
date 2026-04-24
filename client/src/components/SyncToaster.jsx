import { useEffect, useState } from "react";
import { onSyncError } from "@/lib/sync.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Stacked transient toasts surfacing sync failures.
 * 4xx errors returned during outbox flush land here so the user learns
 * that an optimistic change was actually rejected by the server.
 */
export default function SyncToaster() {
  const [toasts, setToasts] = useState([]);
  const t = useT();

  useEffect(() => {
    return onSyncError((e) => {
      const id = `${Date.now()}-${Math.random()}`;
      const message = e.detail?.message || t("sync.defaultError");
      setToasts((prev) => [...prev, { id, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, 6000);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2 px-4 sm:bottom-6 sm:right-6 sm:px-0"
      aria-live="assertive"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          // Toast sits over raw page content — needs its own blur,
          // but `md` (12px) is enough at this small surface size.
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-hanko/40 bg-ink-1/96 p-3 shadow-2xl backdrop-blur-md animate-fade-up"
          role="alert"
        >
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-hanko/20 text-hanko-bright">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-washi">
              {t("sync.changeRejected")}
            </p>
            <p className="mt-0.5 text-xs text-washi-muted">{toast.message}</p>
            <p className="mt-1 text-[10px] text-washi-dim">
              {t("sync.locallyResynced")}
            </p>
          </div>
          <button
            onClick={() =>
              setToasts((prev) => prev.filter((x) => x.id !== toast.id))
            }
            aria-label={t("sync.dismiss")}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-washi-dim transition hover:text-washi"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
