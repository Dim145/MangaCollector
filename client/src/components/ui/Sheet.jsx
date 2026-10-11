import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap.js";
import { useTopLayer } from "@/hooks/useTopLayer.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 片 · A sheet — a native modal `<dialog>` that rises from the bottom
 * edge on a phone and stands centred from `sm:` up.
 *
 * Made for the controls a page keeps out of its first screen (the
 * dashboard's filters and order first). What it promises, after NN/g's
 * guidance on bottom sheets:
 *   - a visible Close button in its header: dismissing never depends on
 *     knowing the swipe or the tap outside;
 *   - one at a time — nothing in a sheet opens another one;
 *   - a drag down on the grabber or the header closes it, and a drag
 *     that falls short springs back;
 *   - its body scrolls inside it, the page behind is inert (top layer)
 *     and does not scroll (`useFocusTrap`'s lock);
 *   - the exit animation plays before it unmounts.
 *
 * `footer` stays pinned under the scrolling body, where a sheet's main
 * action belongs.
 */

// A drag past this distance closes the sheet, and so does a flick
// faster than this speed (px per ms) whatever its length.
const DISMISS_PX = 96;
const DISMISS_SPEED = 0.6;
// Unmounts after this even when no `animationend` arrives (animations
// turned off, a hidden tab).
const EXIT_FALLBACK_MS = 400;

export default function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  glyph,
  children,
  footer,
}) {
  const t = useT();
  const titleId = useId();
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const dialogRef = useRef(null);
  const panelRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return undefined;
    }
    if (!mounted) return undefined;
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useFocusTrap(mounted, panelRef, onClose);
  useTopLayer(dialogRef, mounted);

  if (!mounted || typeof document === "undefined") return null;

  const finishExit = (event) => {
    if (!leaving || event.target !== panelRef.current) return;
    setMounted(false);
    setLeaving(false);
  };

  // 引 · The drag lives on the header only, so the body keeps its own
  // scrolling; `touch-none` there keeps the browser from scrolling the
  // page or starting a pull-to-refresh under the finger.
  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    drag.current = {
      id: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      speed: 0,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panelRef.current.style.transition = "none";
  };
  const onPointerMove = (event) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const elapsed = Math.max(1, event.timeStamp - d.lastT);
    d.speed = (event.clientY - d.lastY) / elapsed;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
    const dy = event.clientY - d.startY;
    // Upwards it resists: the sheet is already as high as it goes.
    panelRef.current.style.transform = `translateY(${dy > 0 ? dy : dy / 4}px)`;
  };
  const onPointerEnd = (event) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    const panel = panelRef.current;
    const dy = event.clientY - d.startY;
    if (event.type === "pointerup" && (dy > DISMISS_PX || d.speed > DISMISS_SPEED)) {
      // The exit keyframes have no `from`: they start where the finger
      // left the sheet instead of jumping back up first.
      panel.style.transition = "";
      onClose?.();
      return;
    }
    panel.style.transition = "transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1)";
    panel.style.transform = "";
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Whole-viewport overlay with the browser's dialog box undone — see
      // `ui/Modal.jsx` for why `flex` waits for `open`.
      // 留 · Clipped: a modal `<dialog>` scrolls by default, and a panel
      // arriving translated made it scroll under its own entrance — see
      // `VolumeDetailDrawer.jsx`. The content scrolls inside, never this.
      className={`fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-clip items-end justify-center border-0 bg-ink-0/70 p-0 text-inherit backdrop-blur-[3px] backdrop:bg-transparent open:flex sm:items-center sm:p-6 ${
        leaving ? "animate-fade-out" : "animate-fade-in"
      }`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onAnimationEnd={finishExit}
        className={`relative flex max-h-[min(88dvh,44rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-ink-1 shadow-2xl focus:outline-none sm:max-w-lg sm:rounded-2xl sm:border-b ${
          leaving ? "animate-sheet-out" : "animate-sheet-in"
        }`}
      >
        {glyph && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-3 -top-3 select-none font-jp text-[120px] leading-none text-hanko-bright/[0.06]"
          >
            {glyph}
          </span>
        )}

        <div
          className="relative flex touch-none items-start justify-between gap-3 border-b border-border/60 px-5 pb-3 pt-2 sm:pt-4"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-washi-dim/40 sm:hidden"
          />
          <div className="min-w-0 pt-4 sm:pt-0">
            {eyebrow && (
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-washi-dim">
                {eyebrow}
              </p>
            )}
            <h2
              id={titleId}
              className="mt-0.5 font-display text-xl italic leading-tight text-washi"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border px-3.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/50 hover:text-washi sm:mt-0"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            {t("common.close")}
          </button>
        </div>

        <div className="relative flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>

        {footer && (
          <div
            className="relative border-t border-border/60 bg-ink-2/40 px-5 pt-3"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
