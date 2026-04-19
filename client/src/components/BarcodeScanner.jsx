import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { startScan } from "@/lib/barcode.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Full-screen camera scanner. Fires `onDetect(rawISBN)` once the parent
 * then takes over the UI (by unmounting the scanner and showing a loading
 * view, result modal, etc.).
 *
 * Rendered via a React portal into `document.body` so it escapes any
 * `isolate` or transform on ancestors that would otherwise trap it
 * under the sticky Header.
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
      if (e.key === "Escape") onCloseRef.current?.();
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
  }, []);

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
        <div className="rounded-2xl border border-border bg-ink-0/70 p-4 backdrop-blur-xl">
          {state === "denied" && (
            <div className="space-y-2 text-center">
              <p className="font-display text-sm font-semibold text-hanko-bright">
                {t("scan.cameraDenied")}
              </p>
              <p className="text-xs text-washi-muted">
                {t("scan.cameraDeniedBody")}
              </p>
            </div>
          )}

          {state === "failed" && (
            <div className="space-y-2 text-center">
              <p className="font-display text-sm font-semibold text-hanko-bright">
                {error ?? t("scan.cameraUnavailable")}
              </p>
              <p className="text-xs text-washi-muted">
                {t("scan.cameraUnavailableBody")}
              </p>
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
            </div>
          )}

          {state === "requesting" && (
            <p className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
              {t("scan.askingPermission")}
            </p>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(scanner, document.body);
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
