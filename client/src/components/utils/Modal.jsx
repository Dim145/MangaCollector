import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Must match `animate-fade-out` / `animate-fade-down-out` duration in CSS. */
const CLOSE_ANIM_MS = 220;

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
  const closeTimer = useRef(null);

  useEffect(() => {
    if (popupOpen) {
      // Opening (or cancelled a mid-flight close): make sure we're mounted
      // and NOT in exit-animation state.
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      setMounted(true);
      setLeaving(false);
      return;
    }

    // popupOpen flipped false — if we weren't mounted there's nothing to do
    // (prevents flashing an exit animation on first render).
    if (!mounted) return;

    setLeaving(true);
    closeTimer.current = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
      closeTimer.current = null;
    }, CLOSE_ANIM_MS);

    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupOpen]);

  useEffect(() => {
    if (!mounted) return;

    const handleKeyUp = (e) => {
      if (e.key === "Escape" && typeof handleClose === "function") {
        handleClose();
      }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [mounted, handleClose]);

  if (!mounted) return null;
  if (typeof document === "undefined") return null;

  // Swap animations based on phase. Entry uses fade-in/fade-up (existing
  // classes); exit uses fade-out/fade-down-out which mirror the entry's
  // opacity+translate curves in reverse, slightly snappier.
  const overlayAnim = leaving ? "animate-fade-out" : "animate-fade-in";
  const contentAnim = leaving ? "animate-fade-down-out" : "animate-fade-up";

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 flex items-center justify-center bg-ink-0/80 backdrop-blur-md p-4 ${overlayAnim}`}
      // Inline style z-index to escape any stacking context traps from
      // ancestors (DefaultBackground's `isolate`, transformed elements, etc.)
      // Portaled to document.body as belt-and-braces.
      style={{ zIndex: 2147483630 }}
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
          className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-ink-1/80 text-washi backdrop-blur transition hover:bg-hanko hover:border-hanko"
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
        className={`relative max-h-[calc(100dvh-2rem)] max-w-full overflow-auto ${contentAnim} ${additionalClasses}`}
      >
        {children}
      </div>
    </div>
  );

  // Portal into <body> so DefaultBackground's `isolate` (and any other
  // ancestor stacking context) can't trap the overlay under the header
  // or adjacent sections.
  return createPortal(overlay, document.body);
}
