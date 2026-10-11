/*
 * 告 · Say something to a screen reader without moving the focus.
 *
 * `document.ariaNotify()` where the browser has it (Safari 27, recent
 * Chromium): the message goes to the assistive technology directly, no
 * element involved. Elsewhere, a polite live region kept in the
 * document for the purpose — cleared first, so the same message twice
 * is spoken twice.
 *
 * For results a reader caused and cannot otherwise hear: a volume put on
 * or taken off the shelf (the tile's name changes, which most screen
 * readers do not repeat), the number of series a filter leaves.
 */
let region = null;
let pending = null;

export function announce(message, { priority = "normal" } = {}) {
  if (!message || typeof document === "undefined") return;
  if (typeof document.ariaNotify === "function") {
    try {
      document.ariaNotify(message, { priority });
      return;
    } catch {
      /* fall through to the live region */
    }
  }
  if (!region || !region.isConnected) {
    region = document.createElement("div");
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("data-announcer", "");
    region.className = "sr-only";
    document.body.appendChild(region);
  }
  region.textContent = "";
  clearTimeout(pending);
  // A beat between the clear and the text, or the change is coalesced
  // away and nothing is read.
  pending = setTimeout(() => {
    region.textContent = message;
  }, 60);
}
