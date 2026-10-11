/*
 * Route prefetch helpers.
 *
 * Every page is its own chunk (`routePages.js`), so a click on a link
 * used to start a round trip for it, then a render that suspended while
 * it arrived. These helpers let interaction surfaces (hover, focus,
 * touchstart) load the page first: by the time the click lands, the
 * route renders it at once (`lib/lazyRoute.js`).
 *
 * Idempotent — each page is imported once and remembered; a failed load
 * is forgotten so a later gesture can try again.
 */

import { pageForPath, preloadPageFor } from "@/routePages.js";

/**
 * Warm up the series page. Safe to call from `onMouseEnter` / `onFocus`
 * — the first call loads it, every later one returns at once.
 */
export function prefetchMangaPage() {
  return prefetchRoute("/mangapage");
}

/*
 * 先 · The pages links lead to. A link knows where it goes before it is
 * clicked: on hover (desktop), on focus (keyboard) and on touchstart (a
 * phone fires it ~100 ms before the click), the page is loaded — not
 * only its chunk fetched, but the module imported and remembered by its
 * route (`lib/lazyRoute.js`), so the click renders it at once instead of
 * suspending. A failed load is forgotten and retried by the next hover.
 */
export function prefetchRoute(path) {
  if (!pageForPath(path)) return null;
  return preloadPageFor(path);
}
