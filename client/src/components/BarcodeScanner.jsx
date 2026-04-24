import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { startScan } from "@/lib/barcode.js";
import { normalizeISBN } from "@/lib/isbn.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Full-screen camera scanner. Fires `onDetect(rawISBN)` once the parent
 * then takes over the UI (by unmounting the scanner and showing a loading
 * view, result modal, etc.).
 *
 * Rendered via a React portal into `document.body` so it escapes any
 * `isolate` or transform on ancestors that would otherwise trap it
 * under the sticky Header.
 *
 * Manual-entry affordance
 * -----------------------
 * Barcodes don't always cooperate — worn EAN bars, book inside a
 * slipcase, reflective mylar, oblique angle, no-camera devices. The
 * scanner exposes a "手入力" (te-nyūryoku, "hand-entry") tray that
 * slides up OVER the camera feed, lets the user type the ISBN
 * directly, and routes through the same `onDetect(raw)` callback
 * as the camera — downstream lookup/add flow is identical.
 */
export default function BarcodeScanner({
  onDetect,
  onClose,
  statusMessage,
  recentCount = 0,
}) {
  const videoRef = useRef(null);
  const stopFnRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const onDetectRef = useRef(onDetect);
  const firedRef = useRef(false);
  const [error, setError] = useState(null);
  const [state, setState] = useState("requesting");
  const [manualOpen, setManualOpen] = useState(false);
  const t = useT();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    let stream = null;
    let disposed = false;
    firedRef.current = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.setAttribute("muted", "true");
        await video.play();
        setState("running");

        stopFnRef.current = await startScan(video, (raw) => {
          if (disposed) return;
          // Fire at most once — parent unmounts us on detection.
          if (firedRef.current) return;
          firedRef.current = true;
          onDetectRef.current?.(raw);
        });
      } catch (err) {
        if (
          err?.name === "NotAllowedError" ||
          err?.name === "SecurityError" ||
          err?.name === "PermissionDeniedError"
        ) {
          setState("denied");
        } else if (err?.name === "NotFoundError") {
          setState("failed");
          setError(null); // use cameraUnavailable label
        } else {
          setState("failed");
          setError(err?.message ?? null);
        }
      }
    })();

    const onKey = (e) => {
      if (e.key === "Escape") {
        // Esc within the manual tray: dismiss the tray, keep the
        // scanner open so the camera stays live.
        if (manualOpen) {
          setManualOpen(false);
          return;
        }
        onCloseRef.current?.();
      }
    };
    window.addEventListener("keyup", onKey);

    return () => {
      disposed = true;
      window.removeEventListener("keyup", onKey);
      (async () => {
        try {
          if (stopFnRef.current) await stopFnRef.current();
        } catch {
          /* ignore */
        }
        if (stream) stream.getTracks().forEach((t) => t.stop());
      })();
    };
    // manualOpen is read by the Esc handler above; re-attach the
    // listener when it flips so the branching stays correct without
    // a ref dance.
  }, [manualOpen]);

  // Submit an ISBN typed by the user — routed through the exact same
  // callback the camera uses, so the downstream flow doesn't care
  // where the number came from.
  const submitManual = (raw) => {
    if (firedRef.current) return;
    firedRef.current = true;
    // The parent's onBarcodeDetected re-validates via normalizeISBN,
    // so we don't need to duplicate the check here — but we do hand
    // off a clean string (no spaces/hyphens) for consistency with
    // what the camera path yields.
    onDetectRef.current?.(normalizeISBN(raw) ?? raw);
  };

  const scanner = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Barcode scanner"
      className="fixed inset-0 isolate bg-ink-0"
      style={{ zIndex: 2147483640 }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        style={{ zIndex: 0 }}
      />

      <div
        className="pointer-events-none absolute inset-0"
        style={{ zIndex: 1 }}
      >
        <ViewfinderOverlay />
      </div>

      {/* Close button — top-left */}
      <button
        type="button"
        onClick={() => onCloseRef.current?.()}
        aria-label={t("scan.closeScanner")}
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

      {/* Status pill — top-right */}
      <div
        className="absolute flex items-center gap-2 rounded-full border border-border bg-ink-0/70 px-3 py-1.5 backdrop-blur-md"
        style={{
          top: `calc(0.75rem + env(safe-area-inset-top))`,
          right: `calc(0.75rem + env(safe-area-inset-right))`,
          zIndex: 10,
        }}
      >
        <span className="relative flex h-2 w-2">
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
              state === "running" ? "animate-ping bg-hanko" : "bg-washi-dim"
            }`}
          />
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              state === "running" ? "bg-hanko" : "bg-washi-dim"
            }`}
          />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi">
          {state === "requesting" && t("scan.opening")}
          {state === "running" && t("scan.scanning")}
          {state === "denied" && t("scan.denied")}
          {state === "failed" && t("scan.unavailable")}
        </span>
      </div>

      {/* Bottom hint bar */}
      <div
        className="absolute inset-x-0 bottom-0 px-4 pb-3"
        style={{
          paddingBottom: `calc(0.75rem + env(safe-area-inset-bottom))`,
          zIndex: 10,
        }}
      >
        {/* Bottom status card — sits over the live camera feed.
            Needs its own blur; `md` is enough to frost a small band
            at the screen bottom without the `xl` GPU tax. */}
        <div className="rounded-2xl border border-border bg-ink-0/78 p-4 backdrop-blur-md">
          {state === "denied" && (
            <div className="space-y-3">
              <div className="space-y-2 text-center">
                <p className="font-display text-sm font-semibold text-hanko-bright">
                  {t("scan.cameraDenied")}
                </p>
                <p className="text-xs text-washi-muted">
                  {t("scan.cameraDeniedBody")}
                </p>
              </div>
              <ManualEntryCTA variant="primary" onClick={() => setManualOpen(true)} t={t} />
            </div>
          )}

          {state === "failed" && (
            <div className="space-y-3">
              <div className="space-y-2 text-center">
                <p className="font-display text-sm font-semibold text-hanko-bright">
                  {error ?? t("scan.cameraUnavailable")}
                </p>
                <p className="text-xs text-washi-muted">
                  {t("scan.cameraUnavailableBody")}
                </p>
              </div>
              <ManualEntryCTA variant="primary" onClick={() => setManualOpen(true)} t={t} />
            </div>
          )}

          {state === "running" && (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold text-washi truncate">
                  {statusMessage ?? t("scan.pointCamera")}
                </p>
                <p className="mt-0.5 text-[11px] text-washi-muted">
                  {t("scan.ean13Hint")}
                </p>
              </div>
              {recentCount > 0 && (
                <div className="shrink-0 rounded-full bg-gold/20 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-gold">
                  {t("scan.scannedCount", { n: recentCount })}
                </div>
              )}
              <ManualEntryCTA variant="ghost" onClick={() => setManualOpen(true)} t={t} />
            </div>
          )}

          {state === "requesting" && (
            <p className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
              {t("scan.askingPermission")}
            </p>
          )}
        </div>
      </div>

      {/* Manual ISBN entry tray — slides up OVER the camera feed
          (camera keeps running underneath for instant return). */}
      <ManualIsbnTray
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSubmit={(raw) => {
          setManualOpen(false);
          submitManual(raw);
        }}
        t={t}
      />
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(scanner, document.body);
}

/**
 * Dual-personality CTA. When the camera is broken, the manual entry
 * IS the primary action — it renders as a filled hanko-bright chip
 * taking the full width of the status card. When the camera is
 * running, manual entry stays available but understated: a small
 * ghost pill tucked next to the detection count so it never competes
 * with the main scanning affordance.
 */
function ManualEntryCTA({ variant, onClick, t }) {
  const kanji = (
    <span
      aria-hidden="true"
      className="font-display text-[13px] leading-none"
      style={{ letterSpacing: "-0.05em" }}
    >
      手
    </span>
  );
  if (variant === "primary") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-full border border-hanko/60 bg-hanko/15 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-hanko-bright transition hover:border-hanko hover:bg-hanko/25 active:scale-[0.985]"
      >
        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100 bg-gradient-to-r from-transparent via-hanko/25 to-transparent" />
        {kanji}
        <span>{t("scan.manualOpen")}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("scan.manualOpen")}
      className="group shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-ink-0/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-washi-muted transition hover:border-hanko/70 hover:bg-hanko/15 hover:text-hanko-bright active:scale-95"
    >
      {kanji}
      <span className="hidden sm:inline">{t("scan.manualOpen")}</span>
    </button>
  );
}

/**
 * Slide-up tray for manual ISBN entry.
 *
 * Design notes:
 *   • Not a full Modal — keeps the camera feed visible (dimmed) so
 *     the transition back to scanning feels continuous rather than
 *     a context switch.
 *   • Big monospace input with `inputMode="numeric"` → mobile
 *     numeric keypad, exact match for ISBN's digits-only reality.
 *   • Accepts paste with spaces/hyphens — the normalisation is done
 *     at submit time, not on keystroke, so the user can see
 *     "978-2-7560-1234-5" while typing without us rejecting it.
 *   • Bottom accent rule shifts hanko → moegi when the input
 *     normalises to a valid ISBN. Visual feedback without
 *     blocking.
 *   • Enter submits if valid, Esc closes the tray (handled by the
 *     scanner's root listener for consistency with other scanner
 *     keybindings).
 */
function ManualIsbnTray({ open, onClose, onSubmit, t }) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  const normalized = normalizeISBN(value);
  const isValid = Boolean(normalized);

  // Reset + autofocus every time the tray opens. Using
  // `requestAnimationFrame` so the focus runs AFTER the tray has
  // been painted in — otherwise iOS Safari occasionally fails to
  // raise the keyboard because the element wasn't visible when
  // focus() was called.
  useEffect(() => {
    if (!open) return;
    setValue("");
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (!isValid) return;
    onSubmit(normalized);
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop — slightly darkens the camera feed so the tray
          pops without killing the "camera still alive" feel. */}
      <button
        type="button"
        aria-label={t("scan.manualCancel")}
        onClick={onClose}
        className="absolute inset-0 bg-ink-0/70 backdrop-blur-sm animate-fade-in"
        style={{ zIndex: 20, cursor: "default" }}
      />

      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-isbn-title"
        // Manual-entry tray — sits over the live camera feed.
        // `md` blur keeps the frosted feel at ~4× lower GPU cost
        // than `xl`. Shadow is directional (above) so its radius
        // stays moderate.
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg overflow-hidden rounded-t-3xl border border-b-0 border-border bg-ink-1/96 shadow-[0_-16px_36px_-12px_rgba(0,0,0,0.7)] backdrop-blur-md"
        style={{
          zIndex: 30,
          paddingBottom: `calc(1.25rem + env(safe-area-inset-bottom))`,
          animation: "mc-tray-up 280ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        }}
      >
        {/* Top hairline — hanko accent */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-hanko/70 to-transparent"
        />
        {/* Grab handle */}
        <div
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-10 rounded-full bg-washi-dim/40"
        />

        <div className="px-6 pt-4 pb-5">
          {/* Eyebrow + title row */}
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
              {t("scan.manualEyebrow")}
            </span>
            <span
              aria-hidden="true"
              className="h-px flex-1 bg-gradient-to-r from-border to-transparent"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label={t("scan.manualCancel")}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-ink-0/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-washi-muted transition hover:border-washi/40 hover:text-washi"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span className="font-display text-[12px] leading-none tracking-normal normal-case">
                戻
              </span>
            </button>
          </div>

          <h2
            id="manual-isbn-title"
            className="mt-2 font-display text-2xl font-light italic leading-tight text-washi md:text-3xl"
          >
            {t("scan.manualTitle")}
          </h2>
          <p className="mt-1 max-w-md text-[12px] text-washi-muted">
            {t("scan.manualByline")}
          </p>

          {/* Input */}
          <div className="mt-5">
            <label
              htmlFor="manual-isbn-input"
              className="mb-1.5 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-washi-dim"
            >
              <span>{t("scan.manualInputLabel")}</span>
              <span
                className={`transition-colors ${
                  isValid
                    ? "text-moegi"
                    : value.length === 0
                      ? "text-washi-dim"
                      : "text-hanko"
                }`}
              >
                {value.length === 0
                  ? ""
                  : isValid
                    ? t("scan.manualValid")
                    : t("scan.manualInvalid")}
              </span>
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="manual-isbn-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                pattern="[0-9\-\s]{10,20}"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t("scan.manualInputPlaceholder")}
                aria-invalid={value.length > 0 && !isValid}
                aria-describedby="manual-isbn-rule"
                className="w-full bg-transparent px-0 py-3 font-mono text-2xl tabular-nums tracking-[0.22em] text-washi placeholder:text-washi-dim/50 focus:outline-none md:text-3xl"
              />
              {/* Bottom rule — morphs between hanko (default/invalid)
                  and moegi (valid) with a subtle grow-in on focus. */}
              <div
                id="manual-isbn-rule"
                aria-hidden="true"
                className="relative h-px w-full overflow-hidden bg-border"
              >
                <div
                  className={`absolute inset-y-0 left-0 transition-[background-color,width] duration-300 ${
                    value.length === 0
                      ? "w-1/4 bg-washi-dim/40"
                      : isValid
                        ? "w-full bg-moegi"
                        : "w-full bg-hanko/70"
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-ink-0/60 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-washi-muted transition hover:border-washi/40 hover:text-washi active:scale-95"
            >
              {t("scan.manualCancel")}
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className="group relative ml-auto inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-full border px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.22em] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 enabled:border-hanko/60 enabled:bg-hanko/15 enabled:text-hanko-bright enabled:hover:border-hanko enabled:hover:bg-hanko/25 disabled:border-border disabled:bg-ink-0/50 disabled:text-washi-dim"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-enabled:group-hover:opacity-100 bg-gradient-to-r from-transparent via-hanko/20 to-transparent"
              />
              <span
                aria-hidden="true"
                className="font-display text-[14px] leading-none"
                style={{ letterSpacing: "-0.05em" }}
              >
                照
              </span>
              <span>{t("scan.manualSubmit")}</span>
            </button>
          </div>
        </div>

        {/* Local keyframes — Tailwind's animate-slide-up is reserved
            for top-of-viewport entrances (and lives in the global
            CSS). A bottom-up tray needs its own curve. */}
        <style>{`
          @keyframes mc-tray-up {
            from {
              opacity: 0;
              transform: translateY(28px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </form>
    </>
  );
}

function ViewfinderOverlay() {
  return (
    <svg
      className="h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <mask id="viewfinder-mask">
          <rect width="100" height="100" fill="white" />
          <rect x="10" y="38" width="80" height="24" rx="3" fill="black" />
        </mask>
      </defs>
      <rect
        width="100"
        height="100"
        fill="rgba(10, 9, 8, 0.6)"
        mask="url(#viewfinder-mask)"
      />
      <g
        stroke="oklch(0.6 0.22 25)"
        strokeWidth="0.6"
        strokeLinecap="round"
        fill="none"
      >
        <path d="M 10 44 L 10 38 L 16 38" />
        <path d="M 84 38 L 90 38 L 90 44" />
        <path d="M 90 56 L 90 62 L 84 62" />
        <path d="M 16 62 L 10 62 L 10 56" />
      </g>
      <line
        x1="12"
        x2="88"
        y1="50"
        y2="50"
        stroke="oklch(0.82 0.13 78)"
        strokeWidth="0.3"
        opacity="0.5"
      >
        <animate
          attributeName="y1"
          values="40;60;40"
          dur="2.5s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="y2"
          values="40;60;40"
          dur="2.5s"
          repeatCount="indefinite"
        />
      </line>
    </svg>
  );
}
