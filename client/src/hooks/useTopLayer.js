import { useLayoutEffect } from "react";

/**
 * 層 · Opens a mounted `<dialog>` as a modal — in the browser's top layer.
 *
 * The modal and the volume drawer used to be `<div>`s portalled into
 * `<body>` with a z-index of 2 147 483 630 and `aria-modal`. In the top
 * layer they need no z-index (each sits above the one opened before it,
 * whatever the stacking contexts around), and the rest of the page is
 * inert for real — not only for screen readers that honour `aria-modal`.
 *
 * The rest stays where it was: `useFocusTrap` still moves focus in,
 * cycles Tab, locks the scroll, closes on Escape and gives focus back;
 * the components still play their exit animation before unmounting. So
 * the native Escape (`cancel`) is turned down here — closing at once
 * would skip that animation — and the trap's own Escape does the work.
 *
 * Opened in a layout effect, before the first paint, so a dialog is
 * never seen outside the top layer. Where `showModal` is missing or
 * refuses, the `open` attribute alone still shows it.
 */
export function useTopLayer(ref, active) {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return undefined;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }
    const keepOpen = (event) => event.preventDefault();
    dialog.addEventListener("cancel", keepOpen);
    return () => {
      dialog.removeEventListener("cancel", keepOpen);
      if (dialog.open) {
        try {
          dialog.close();
        } catch {
          dialog.removeAttribute("open");
        }
      }
    };
  }, [ref, active]);
}
