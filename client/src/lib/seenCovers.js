/*
 * 既 · Covers already drawn in this page's life.
 *
 * A windowed grid unmounts the tiles that leave its window and mounts
 * them again when they come back, and the library mounts afresh on
 * every return from a series. Each new mount started from nothing — no
 * `<img>` until the observer answered, then a 300 ms fade from the
 * swatch — so a cover the reader had just seen flashed its swatch again,
 * under the eye: eight to twenty-four tiles at once coming back from a
 * series, a dozen at a time on a fast scroll up the shelf. A cover the
 * browser already holds is drawn at once instead (`ui/CoverImage.jsx`):
 * no observer, no lazy wait, no fade.
 *
 * Addresses only, bounded, and forgotten with the caches on the way out
 * (`lib/db.js`) — the browser's own cache is wiped there too.
 */
const seen = new Set();
const MAX = 2000;

export function hasSeenCover(src) {
  return Boolean(src) && seen.has(src);
}

export function rememberSeenCover(src) {
  if (!src || seen.has(src)) return;
  if (seen.size >= MAX) seen.delete(seen.values().next().value);
  seen.add(src);
}

export function forgetSeenCovers() {
  seen.clear();
}
