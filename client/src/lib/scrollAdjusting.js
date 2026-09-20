/**
 * 整 · A short flag saying "the last scroll was not the reader".
 *
 * A window virtualizer corrects the scroll offset when a row turns out
 * to be a different height than it guessed, so that what is under the
 * reader's eye stays put. That correction arrives as an ordinary
 * `scroll` event, indistinguishable from someone turning a wheel — and
 * the library's scroll memory recorded it as the position to come back
 * to. Clicking a series moved the page 599 px in the same breath, so
 * "back" returned 599 px above where the reader had been.
 *
 * It only became visible when those corrections were made instant:
 * before, the stylesheet's `scroll-behavior: smooth` animated them and
 * the page navigated away before the animation reached its end. The
 * bug was there all along, hidden behind a slow animation.
 *
 * Kept deliberately small and time-based rather than a counter: a
 * missed `clear` would silence the memory for the rest of the session,
 * where a stale window costs one ignored scroll event.
 */

const WINDOW_MS = 150;

let until = 0;

/** Called by the virtualizer's scroll function, just before it moves. */
export function markScrollAdjustment() {
  until = now() + WINDOW_MS;
}

/** Is a scroll arriving right now the virtualizer's own doing? */
export function isScrollAdjusting() {
  return now() < until;
}

/** Test seam. */
export function _resetScrollAdjustment() {
  until = 0;
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
