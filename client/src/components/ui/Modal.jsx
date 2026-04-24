import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Must match `animate-fade-out` / `animate-fade-down-out` duration in CSS. */
const CLOSE_ANIM_MS = 220;

/**
 * Module-level body-scroll lock. When multiple Modals stack (e.g. a
 * multi-step flow that transitions modal 1 → modal 2), a naive per-
 * instance approach corrupts the original-overflow capture:
 *
 *   1. Modal 1 mounts, captures prev="", sets overflow="hidden"
 *   2. Modal 2 mounts BEFORE modal 1's 220ms leave anim completes,
 *      captures prev="hidden" (modal 1's lock!), sets overflow="hidden"
 *   3. Modal 1 unmounts, restores overflow="" — body unlocks even though
 *      modal 2 is still visible
 *   4. Modal 2 unmounts, restores overflow="hidden" — body LOCKED
 *      forever, and only a full page reload clears it
 *
 * Reference-counting the active modals fixes it: only the first mount
 * captures and locks, only the last unmount restores.
 */
let activeModalCount = 0;
let originalBodyOverflow = null;

function acquireScrollLock() {
  if (activeModalCount === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  activeModalCount += 1;
}

function releaseScrollLock() {
  activeModalCount = Math.max(0, activeModalCount - 1);
  if (activeModalCount === 0) {
    document.body.style.overflow = originalBodyOverflow ?? "";
    originalBodyOverflow = null;
  }
}

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

  // Ref on the dialog root — used for initial-focus + focus-trap logic.
  const overlayRef = useRef(null);
  const lastFocusedBeforeOpenRef = useRef(null);

  useEffect(() => {
    if (!mounted) return;

    const handleKeyUp = (e) => {
      if (e.key === "Escape" && typeof handleClose === "function") {
        handleClose();
      }
    };

    // Focus-trap keydown handler. Tab / Shift+Tab cycles focus among
    // the modal's tabbables and refuses to hand focus back to the
    // page behind. Using `keydown` instead of the existing `keyup`
    // Escape handler because Tab needs `preventDefault()` on the
    // keydown phase to actually block the browser's native cycle.
    const handleKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const root = overlayRef.current;
      if (!root) return;
      // Enumerate tabbable descendants. The `:not([disabled]):not([aria-hidden="true"])`
      // chain matches the WAI-ARIA authoring-practices focus-trap
      // recipe closely enough for our bespoke modals, without
      // pulling in a dedicated library (focus-trap / react-aria).
      const selector =
        'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';
      const tabbables = root.querySelectorAll(selector);
      if (!tabbables.length) {
        e.preventDefault();
        return;
      }
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture the element that opened the modal so we can restore
    // focus to it on close. Covers the common case where a <button>
    // triggered the modal — screen readers + keyboard users expect
    // to land back on it.
    lastFocusedBeforeOpenRef.current = document.activeElement;

    acquireScrollLock();
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("keydown", handleKeyDown);

    // Move focus INTO the modal so the first Tab cycles through
    // modal controls rather than leaking back to the page. We try
    // the first autofocus-eligible child, then the overlay itself
    // (made tabbable via tabIndex=-1 on the div below).
    requestAnimationFrame(() => {
      const root = overlayRef.current;
      if (!root) return;
      const preferred = root.querySelector("[data-autofocus]");
      if (preferred && typeof preferred.focus === "function") {
        preferred.focus();
      } else if (typeof root.focus === "function") {
        root.focus();
      }
    });

    return () => {
      releaseScrollLock();
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the opener — only if it still exists in the
      // DOM and is focusable; otherwise blur silently.
      const opener = lastFocusedBeforeOpenRef.current;
      if (opener && typeof opener.focus === "function" && document.contains(opener)) {
        try {
          opener.focus();
        } catch {
          /* opener could be a detached node — ignore */
        }
      }
      lastFocusedBeforeOpenRef.current = null;
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
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      // tabIndex=-1 makes the overlay programmatically focusable so
      // our initial-focus fallback can land here when the children
      // expose no `data-autofocus` candidate. Users can't Tab to it
      // because of the negative value — it's only reachable via
      // `element.focus()`.
      tabIndex={-1}
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
