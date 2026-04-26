import { useEffect, useState } from "react";
import { onSyncError, onSyncInfo } from "@/lib/sync.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 報 · Stacked transient toasts surfacing sync events.
 *
 * Two channels feed this component:
 *
 *   1. **Errors** — `onSyncError`: 4xx outbox-flush rejections + any
 *      direct mutation that called `notifySyncError(...)`. Render
 *      shell uses hanko (red ink) tones — the same alert vocabulary
 *      a Japanese stamp would impress on a contested document.
 *
 *   2. **Info / success** — `onSyncInfo`: actions that completed
 *      successfully but want to confirm an outcome (e.g. the
 *      upcoming-volume refresh reporting "+2 added, 1 updated").
 *      Render shell uses moegi (green-tea ink) when there's
 *      something to celebrate; falls back to washi (cream) when the
 *      outcome is "all good but nothing changed."
 *
 * Both variants share layout, motion, and dismiss UX so the user
 * develops a single mental model for "the corner where the app
 * tells me the result of what just happened."
 */
const ERROR_TTL_MS = 6_000;
const INFO_TTL_MS = 5_000;

export default function SyncToaster() {
  const [toasts, setToasts] = useState([]);
  const t = useT();

  useEffect(() => {
    // 失 · Failure stream — mirrors the original behaviour, just
    // reshaped through the unified toast-row schema below.
    const offError = onSyncError((e) => {
      const id = `err-${Date.now()}-${Math.random()}`;
      setToasts((prev) => [
        ...prev,
        {
          id,
          kind: "error",
          tone: "error",
          title: t("sync.changeRejected"),
          body: e.detail?.message || t("sync.defaultError"),
          footer: t("sync.locallyResynced"),
        },
      ]);
      // Auto-dismiss; the user can also close manually.
      setTimeout(
        () => setToasts((prev) => prev.filter((x) => x.id !== id)),
        ERROR_TTL_MS,
      );
    });

    // 報 · Success/info stream — caller pre-shapes the payload so
    // we don't have to keep an op-to-message switch in the toaster.
    const offInfo = onSyncInfo((e) => {
      const p = e.detail || {};
      const id = `info-${Date.now()}-${Math.random()}`;
      setToasts((prev) => [
        ...prev,
        {
          id,
          kind: "info",
          tone: p.tone === "neutral" ? "neutral" : "success",
          icon: p.icon,
          title: p.title || t("sync.infoDefaultTitle"),
          body: p.body,
        },
      ]);
      setTimeout(
        () => setToasts((prev) => prev.filter((x) => x.id !== id)),
        INFO_TTL_MS,
      );
    });

    return () => {
      offError();
      offInfo();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2 px-4 sm:bottom-6 sm:right-6 sm:px-0"
      // `aria-live="polite"` for the success path is honestly more
      // accurate than the previous "assertive" — info toasts
      // shouldn't interrupt screen-reader speech the way an error
      // legitimately does. Errors keep their assertive announcement
      // by living inside their own row's `role="alert"` below.
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastRow
          key={toast.id}
          toast={toast}
          onDismiss={() =>
            setToasts((prev) => prev.filter((x) => x.id !== toast.id))
          }
        />
      ))}
    </div>
  );
}

/**
 * 一枚 · One toast slip. Visual treatment varies by `toast.tone`:
 *
 *   - `error`   — hanko red border + alert glyph, role="alert"
 *   - `success` — moegi green-tea border + custom glyph (kanji /
 *                 symbol) provided by the caller, role="status"
 *   - `neutral` — washi/cream border + same glyph, role="status"
 *
 * The Japanese-paper feel is reinforced by:
 *
 *   - `backdrop-blur-md` over `bg-ink-1/96` so the slip floats with
 *     a subtle depth instead of sitting flat on the page
 *   - a **left rule** at the leading edge — like the seal margin on
 *     handwritten letterhead — colored per tone
 *   - a soft inner ring on the glyph badge, nodding to a stamp's
 *     embossed border without dominating the row
 */
function ToastRow({ toast, onDismiss }) {
  const t = useT();

  // Per-tone palette + glyph defaults. Centralising the
  // tone→className mapping here keeps the JSX readable and prevents
  // drift between the border / icon / left-rule colours.
  const palette =
    toast.tone === "success"
      ? {
          edge: "before:bg-moegi",
          border: "border-moegi/45",
          badgeBg: "bg-moegi/20",
          badgeFg: "text-moegi",
          ring: "ring-1 ring-inset ring-moegi/30",
        }
      : toast.tone === "neutral"
        ? {
            edge: "before:bg-washi/70",
            border: "border-washi/35",
            badgeBg: "bg-washi/15",
            badgeFg: "text-washi",
            ring: "ring-1 ring-inset ring-washi/25",
          }
        : {
            // error
            edge: "before:bg-hanko",
            border: "border-hanko/40",
            badgeBg: "bg-hanko/20",
            badgeFg: "text-hanko-bright",
            ring: "",
          };

  // Default icon for the error variant is the SVG alert glyph
  // (kept inline below so the existing screen-reader text doesn't
  // change). Info variants use the caller-supplied `toast.icon`
  // (typically a kanji like 来) and fall back to a check mark.
  const isError = toast.kind === "error";
  const role = isError ? "alert" : "status";

  return (
    <div
      role={role}
      // The `before:` pseudo creates the seal-margin left rule.
      className={`pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border ${palette.border} bg-ink-1/96 p-3 pl-4 shadow-2xl backdrop-blur-md animate-fade-up before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] ${palette.edge}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${palette.badgeBg} ${palette.badgeFg} ${palette.ring}`}
      >
        {isError ? (
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
        ) : toast.icon ? (
          // Caller-supplied glyph — typically a single kanji.
          // `font-jp` swaps to the project's display Japanese face;
          // `tracking-normal` overrides any inherited tracking from
          // a wrapper that thought it was uppercased label text.
          <span className="font-jp text-sm font-bold leading-none tracking-normal">
            {toast.icon}
          </span>
        ) : (
          // Default success glyph: a check mark, sized to match.
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-washi">
          {toast.title}
        </p>
        {toast.body && (
          <p className="mt-0.5 text-xs text-washi-muted">{toast.body}</p>
        )}
        {toast.footer && (
          <p className="mt-1 text-[10px] text-washi-dim">{toast.footer}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
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
  );
}
