/*
 * 先 · The covers a page opens on, remembered for the next visit.
 *
 * A single-page app's largest image is invisible to the browser until
 * the JavaScript has run, read the shelf from IndexedDB and rendered it:
 * on a phone that is two to three seconds of a cover that could have
 * been downloading all along (Lighthouse: "LCP request not discoverable
 * in the initial document"). So the covers the page displayed first are
 * kept here — as the `<img>` described them: `src`, `srcset` and
 * `sizes` — and the inline script at the top of `index.html` preloads
 * them with `imagesrcset`/`imagesizes` as soon as the document starts
 * parsing. The browser then picks the rendition with the same rules it
 * applies to the `<img>`, so the two agree. (Keeping the URL it had
 * picked last time did not: measured, the preload fetched the 256 px
 * rendition, the `<img>` then asked for the 512 one, and the cover
 * arrived later than with no preload at all.)
 *
 * Only what a fresh arrival will show again is recorded: the landing's
 * own shelf (most recently touched first), and the dashboard in its
 * default view (a fresh session starts there; a filtered or re-sorted
 * shelf opens on other covers). Being wrong costs one image fetched for
 * nothing; the next visit corrects it.
 *
 * These are addresses from the reader's library, so the logout and
 * account-switch wipes in `lib/db.js` remove them with everything else.
 */
export const LCP_HINT_PREFIX = "mc:lcp:";
export const LCP_HINT_LIMIT = 2;

const same = (a, b) =>
  a != null &&
  b != null &&
  a.src === b.src &&
  (a.srcset ?? null) === (b.srcset ?? null) &&
  (a.sizes ?? null) === (b.sizes ?? null);

/**
 * Record the `rank`-th cover `path` opened on, as `{ src, srcset, sizes }`
 * — the attributes of its `<img>`.
 */
export function rememberLcpCover(path, rank, image) {
  if (!image || typeof image.src !== "string" || !image.src) return;
  if (!Number.isInteger(rank) || rank < 0 || rank >= LCP_HINT_LIMIT) return;
  const entry = {
    src: image.src,
    ...(image.srcset ? { srcset: image.srcset, sizes: image.sizes || "100vw" } : {}),
  };
  try {
    const key = LCP_HINT_PREFIX + path;
    const current = readLcpCovers(path);
    const next = Array.from({ length: LCP_HINT_LIMIT }, (_, i) => current[i] ?? null);
    if (same(next[rank], entry)) return;
    next[rank] = entry;
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* private mode / quota — the next visit simply starts cold */
  }
}

/** What `path` opened on last time, as an array (empty when unknown). */
export function readLcpCovers(path) {
  try {
    const parsed = JSON.parse(localStorage.getItem(LCP_HINT_PREFIX + path) || "null");
    return Array.isArray(parsed) ? parsed.slice(0, LCP_HINT_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Forget every page's covers — part of the device wipe. */
export function clearLcpHints() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(LCP_HINT_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* private mode */
  }
}
