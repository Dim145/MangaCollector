import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap.js";
import { useTopLayer } from "@/hooks/useTopLayer.js";

export default function Modal({
  children,
  popupOpen,
  additionalClasses = "",
  handleClose,
}) {
  // Decouple DOM lifecycle from the `popupOpen` prop:
  //   - opening:  mount immediately, play entry animation
  //   - closing:  flag `leaving=true`, play exit animation, unmount after it
  // This is the classic "delayed unmount" pattern for exit animations with
  // no library dependency.
  const [mounted, setMounted] = useState(popupOpen);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (popupOpen) {
      // Opening (or cancelled a mid-flight close): make sure we're mounted
      // and NOT in exit-animation state.
      setMounted(true);
      setLeaving(false);
      return;
    }

    // popupOpen flipped false — if we weren't mounted there's nothing to do
    // (prevents flashing an exit animation on first render).
    if (!mounted) return;

    setLeaving(true);

    // 終 · Wait for the CSS exit animation to actually finish before
    // unmounting. Previously this was a `setTimeout(CLOSE_ANIM_MS=220)`
    // that had to be kept in lock-step with the CSS keyframe duration —
    // change one without the other and the modal either jumped (timer
    // shorter than anim) or the user saw a frozen still after the
    // anim ended (timer longer). Using `getAnimations({ subtree: true })`
    // + `Promise.all(.finished)` makes the CSS the single source of
    // truth: whatever duration the keyframe carries, we wait exactly
    // that long.
    //
    // `requestAnimationFrame` defers one frame so React has rendered
    // the new className (with the exit-anim class) and the browser has
    // started the animation — `getAnimations()` called too early
    // returns `[]` and the unmount fires instantly.
    //
    // Infinite animations are filtered out: a spinner inside the modal
    // body never resolves its `.finished` promise, which would hang
    // the unmount forever. Only finite (entry/exit) animations gate
    // the close.
    let cancelled = false;
    const rafHandle = requestAnimationFrame(async () => {
      if (cancelled) return;
      const root = overlayRef.current;
      const anims = root
        ? root
            .getAnimations({ subtree: true })
            .filter((a) => {
              const t = a.effect?.getComputedTiming?.();
              return t && t.iterations !== Infinity;
            })
        : [];
      try {
        await Promise.all(anims.map((a) => a.finished));
      } catch {
        // Animation was cancelled (tab hidden, browser interrupted
        // it, etc.). The finished promise rejects but we still want
        // to unmount — falling through is the correct behaviour.
      }
      if (!cancelled) {
        setMounted(false);
        setLeaving(false);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafHandle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupOpen]);

  // Ref on the dialog root — used by the focus trap for tab cycling,
  // initial focus, and ESC handling. Scroll lock + opener-restore are
  // handled inside the hook too. See `hooks/useFocusTrap.js`.
  const overlayRef = useRef(null);
  useFocusTrap(mounted, overlayRef, handleClose);
  // 層 · A native modal `<dialog>`: the top layer, an inert page behind.
  useTopLayer(overlayRef, mounted);

  if (!mounted) return null;
  if (typeof document === "undefined") return null;

  // Swap animations based on phase. Entry uses fade-in/fade-up (existing
  // classes); exit uses fade-out/fade-down-out which mirror the entry's
  // opacity+translate curves in reverse, slightly snappier.
  const overlayAnim = leaving ? "animate-fade-out" : "animate-fade-in";
  const contentAnim = leaving ? "animate-fade-down-out" : "animate-fade-up";

  const overlay = (
    <dialog
      ref={overlayRef}
      // tabIndex=-1 makes the overlay programmatically focusable so
      // our initial-focus fallback can land here when the children
      // expose no `data-autofocus` candidate. Users can't Tab to it
      // because of the negative value — it's only reachable via
      // `element.focus()`.
      tabIndex={-1}
      // The dialog is the whole-viewport overlay, as the `<div>` it
      // replaces was: the browser's own box (margin, border, padding,
      // max sizes, Canvas colours) is undone, `flex` only while open
      // (an author `display` would otherwise show a closed dialog), and
      // `::backdrop` stays clear — the dim and the blur are this element.
      className={`fixed inset-0 m-0 h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-ink-0/80 p-4 text-inherit backdrop-blur-md backdrop:bg-transparent open:flex focus:outline-none ${overlayAnim}`}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        handleClose?.();
      }}
    >
      {/* Close button */}
      {handleClose && (
        <button
          onClick={handleClose}
          aria-label="Close"
          className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-ink-1/80 text-washi hover:text-on-hanko backdrop-blur transition hover:bg-hanko hover:border-hanko"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}

      <div
        className={`relative max-h-[calc(100dvh_-_2rem)] max-w-full overflow-auto ${contentAnim} ${additionalClasses}`}
      >
        {children}
      </div>
    </dialog>
  );

  // Portal into <body>: the top layer escapes stacking contexts on its
  // own, but a dialog rendered inside a page would still inherit that
  // page's text styles.
  return createPortal(overlay, document.body);
}
