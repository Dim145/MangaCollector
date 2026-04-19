import { createPortal } from "react-dom";

/**
 * Full-screen loading overlay shown while an ISBN is being resolved (or
 * a transient error is being auto-recovered). Rendered via a portal so it
 * takes the same pixel real estate as the scanner and escapes any ancestor
 * `isolate` or transform.
 */
export default function ScanLoadingView({
  statusMessage,
  errorMessage,
  onClose,
}) {
  const isError = Boolean(errorMessage);

  const view = (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 isolate grain bg-ink-0"
      style={{ zIndex: 2147483640 }}
    >
      {/* Atmospheric glow */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        <div
          className="absolute left-1/2 top-1/3 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-3xl"
          style={{
            background: isError
              ? "radial-gradient(circle, oklch(0.68 0.24 25 / 0.35), transparent 70%)"
              : "radial-gradient(circle, oklch(0.6 0.22 25 / 0.25), transparent 70%)",
          }}
        />
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute grid h-12 w-12 place-items-center rounded-full border border-border bg-ink-0/80 text-washi backdrop-blur-md transition hover:bg-hanko hover:border-hanko active:scale-95"
        style={{
          top: `calc(0.75rem + env(safe-area-inset-top))`,
          left: `calc(0.75rem + env(safe-area-inset-left))`,
          zIndex: 10,
          cursor: "pointer",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="relative z-[5] flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="relative">
          {!isError && (
            <div className="absolute inset-0 animate-ping rounded-lg bg-hanko/30" />
          )}
          <span
            className={`hanko-seal relative grid h-20 w-20 place-items-center rounded-lg font-display text-3xl font-bold ${
              isError ? "" : "animate-pulse-glow"
            }`}
            style={
              isError
                ? { background: "oklch(0.68 0.24 25)" }
                : undefined
            }
          >
            {isError ? "!" : "検"}
          </span>
        </div>

        <div className="max-w-md space-y-2">
          <p
            className={`font-display text-xl italic ${
              isError ? "text-hanko-bright" : "text-washi"
            }`}
          >
            {isError ? "Something went wrong" : "Looking up ISBN…"}
          </p>
          <p
            className={`text-sm ${
              isError ? "text-washi" : "text-washi-muted"
            }`}
          >
            {errorMessage || statusMessage || "A single moment."}
          </p>
          {!isError && (
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              Querying Google Books · MyAnimeList
            </p>
          )}
          {isError && (
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              Retrying automatically…
            </p>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(view, document.body);
}
