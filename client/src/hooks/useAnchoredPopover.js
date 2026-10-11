import { useEffect, useId, useLayoutEffect } from "react";

/**
 * 錨 · A panel opened from a button — a menu, the genre list, the sort
 * order — as a native popover placed by CSS anchor positioning.
 *
 * What the platform does here that the hand-written version did not:
 *   - the top layer: above every stacking context with no z-index;
 *   - light dismiss: a click outside or Escape closes it, and opening
 *     another one closes this one — popovers never pile up;
 *   - with the button as its `source`, the panel comes right after the
 *     button in the Tab order, wherever it sits in the DOM (it is
 *     portalled to `<body>`), and a click on that button no longer
 *     counts as a click outside;
 *   - anchor positioning keeps it under the button through scrolling
 *     and resizing without a listener, and flips it above the button
 *     when there is no room below.
 *
 * Where a browser lacks one of them it falls back piece by piece: no
 * popover API → the panel is a `position: fixed` element with its own
 * outside-click and Escape handling; no anchor positioning → it is
 * placed from the button's rectangle and follows it on scroll.
 *
 * The caller keeps `open` in React state and renders the panel only
 * while it is true, with `POPOVER_PANEL_CLASS` among its classes; the
 * hook tells it when the browser closed it.
 *
 * @param {object} options
 * @param {boolean} options.open
 * @param {(open: boolean) => void} options.onClose
 * @param {React.RefObject<HTMLElement>} options.buttonRef
 * @param {React.RefObject<HTMLElement>} options.panelRef
 * @param {number} [options.gap=8]  - px between the button and the panel
 */
export function useAnchoredPopover({ open, onClose, buttonRef, panelRef, gap = 8 }) {
  const anchorName = `--anchor-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useLayoutEffect(() => {
    if (!open) return undefined;
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel) return undefined;
    const cleanups = [];

    // Focus that was inside the panel goes back to the button when it
    // closes — Escape, a choice, the button itself. The browser only does
    // this when it moved the focus in itself, and the genre list's search
    // field takes it on mount. A click elsewhere keeps its own focus.
    // React focuses an `autoFocus` field inside the panel before this
    // effect runs, so the starting point is read, not assumed.
    let focusInside = panel.contains(document.activeElement);
    const onFocusIn = () => {
      focusInside = true;
    };
    // Only a focus that went to another element left the panel: one
    // that went nowhere was blurred by the panel being hidden.
    const onFocusOut = (event) => {
      if (event.relatedTarget && !panel.contains(event.relatedTarget)) {
        focusInside = false;
      }
    };
    panel.addEventListener("focusin", onFocusIn);
    panel.addEventListener("focusout", onFocusOut);
    cleanups.push(() => {
      panel.removeEventListener("focusin", onFocusIn);
      panel.removeEventListener("focusout", onFocusOut);
      const active = document.activeElement;
      if (focusInside && (!active || active === document.body || panel.contains(active))) {
        button.focus({ preventScroll: true });
      }
    });

    if (supportsPopover()) {
      panel.setAttribute("popover", "auto");
      try {
        panel.showPopover({ source: button });
      } catch {
        try {
          panel.showPopover();
        } catch {
          /* already open, or detached — the fallback below still places it */
        }
      }
      const onToggle = (event) => {
        if (event.newState === "closed") onClose();
      };
      panel.addEventListener("toggle", onToggle);
      cleanups.push(() => {
        panel.removeEventListener("toggle", onToggle);
        try {
          if (panel.matches(":popover-open")) panel.hidePopover();
        } catch {
          /* gone with its subtree */
        }
      });
    }

    if (supportsAnchor()) {
      button.style.setProperty("anchor-name", anchorName);
      panel.style.setProperty("position-anchor", anchorName);
      panel.style.setProperty("top", `calc(anchor(bottom) + ${gap}px)`);
      panel.style.setProperty("right", "anchor(right)");
      panel.style.setProperty("position-try-fallbacks", "flip-block");
      cleanups.push(() => button.style.removeProperty("anchor-name"));
    } else {
      const place = () => {
        const r = button.getBoundingClientRect();
        panel.style.top = `${r.bottom + gap}px`;
        panel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
      };
      place();
      // `capture` catches scrolls on any ancestor that could move the button.
      window.addEventListener("scroll", place, { capture: true, passive: true });
      window.addEventListener("resize", place);
      cleanups.push(() => {
        window.removeEventListener("scroll", place, { capture: true });
        window.removeEventListener("resize", place);
      });
    }

    return () => cleanups.forEach((fn) => fn());
    // `onClose` is read when the browser closes the panel; a new identity
    // on every render must not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, buttonRef, panelRef, anchorName, gap]);

  // Without the popover API, the light dismiss is ours to do.
  useEffect(() => {
    if (!open || supportsPopover()) return undefined;
    const onPointer = (event) => {
      if (buttonRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      onClose();
    };
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keyup", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, buttonRef, panelRef]);
}

/**
 * The classes a panel needs whichever path it takes: fixed, placed by
 * the hook (the popover UA sheet centres it with `inset: 0; margin:
 * auto` and pads it), and above the page when it is not in the top
 * layer.
 */
export const POPOVER_PANEL_CLASS =
  "fixed m-0 p-0 [inset:auto] z-[2147483620] text-washi";

export function supportsPopover() {
  return (
    typeof HTMLElement !== "undefined" &&
    typeof HTMLElement.prototype.showPopover === "function"
  );
}

export function supportsAnchor() {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("anchor-name: --a") &&
    CSS.supports("position-try-fallbacks: flip-block")
  );
}
