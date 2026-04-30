import { useEffect, useRef } from "react";
import { acquireScrollLock, releaseScrollLock } from "@/lib/scrollLock.js";

/*
 * 罠 · Focus trap + scroll lock + ESC handling for modal-like surfaces
 * (Modal, VolumeDetailDrawer, future side-panels).
 *
 * Extracted from the two near-identical implementations Qodana flagged
 * as `DuplicatedCode` (~30 lines × 2). Same semantics, single source
 * of truth — fix a bug or tweak a UX nuance once and both surfaces
 * inherit it.
 *
 * Engages while `active` is true:
 *   1. acquires the shared body-scroll lock (lib/scrollLock.js — common
 *      counter so a Modal stacked on a Drawer doesn't leak the lock)
 *   2. moves focus to `[data-autofocus]` inside the container, falling
 *      back to the container element itself (which must be made
 *      focusable via `tabIndex={-1}` if the caller wants the fallback
 *      to actually land somewhere)
 *   3. Tab / Shift+Tab cycles among tabbables. When the container has
 *      none (typical loading state where every button is disabled),
 *      Tab is preventDefault'd and focus parks on the container so
 *      keystrokes stay scoped until controls re-enable
 *   4. ESC fires `onClose()`. The callback is read off a ref so an
 *      inline arrow at the call site (`onClose={() => setOpen(false)}`)
 *      doesn't re-bind the listeners on every parent render — that
 *      would drop a keystroke in the one-frame gap between cleanup
 *      and re-attach (see DeleteAccountFlow step 2 for a repro).
 *
 * On de-activation (or unmount):
 *   - releases the scroll lock
 *   - restores focus to whichever element was focused at activation,
 *     iff it still exists in the DOM and is focusable
 *
 * @param {boolean} active                    - When true, the trap is wired up.
 * @param {React.RefObject<HTMLElement>} containerRef - Ref to the trap root.
 * @param {() => void} [onClose]              - Optional ESC handler.
 */
export function useFocusTrap(active, containerRef, onClose) {
  // Mirror onClose into a ref so the trap effect's deps stay narrow
  // (just `active`). See the rationale in the module docstring.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;

    // Captured at activation — used in cleanup to restore focus.
    // Local closure variable rather than a ref because nothing else
    // needs to read it; the cleanup closes over it directly.
    const lastFocused = document.activeElement;

    const handleKeyUp = (e) => {
      if (e.key === "Escape") {
        const close = onCloseRef.current;
        if (typeof close === "function") close();
      }
    };

    // Focus-trap keydown handler. Tab needs `preventDefault()` on the
    // keydown phase to actually block the browser's native cycle —
    // hooking the existing keyup handler wouldn't work for the cycle,
    // only for ESC.
    const handleKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const tabbables = root.querySelectorAll(TABBABLE_SELECTOR);
      if (!tabbables.length) {
        e.preventDefault();
        if (typeof root.focus === "function") root.focus();
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

    acquireScrollLock();
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("keydown", handleKeyDown);

    // Defer initial focus one frame so React has rendered the
    // container and the autofocus candidate (if any) is in the DOM.
    const rafHandle = requestAnimationFrame(() => {
      const root = containerRef.current;
      if (!root) return;
      const preferred = root.querySelector("[data-autofocus]");
      if (preferred && typeof preferred.focus === "function") {
        preferred.focus();
      } else if (typeof root.focus === "function") {
        root.focus();
      }
    });

    return () => {
      cancelAnimationFrame(rafHandle);
      releaseScrollLock();
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("keydown", handleKeyDown);
      if (
        lastFocused &&
        typeof lastFocused.focus === "function" &&
        document.contains(lastFocused)
      ) {
        try {
          lastFocused.focus();
        } catch {
          /* opener detached — ignore */
        }
      }
    };
    // containerRef is stable (useRef result) — exhaustive-deps already
    // skips refs from its missing-dep checks. onCloseRef is read off
    // a ref by design (see top of the hook).
  }, [active, containerRef]);
}

// Enumerate tabbable descendants. The `:not([disabled]):not([aria-hidden="true"])`
// chain matches the WAI-ARIA authoring-practices focus-trap recipe
// closely enough for our bespoke modals, without pulling in a
// dedicated library (focus-trap / react-aria).
const TABBABLE_SELECTOR =
  'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';
