/*
 * Route-chunk prefetch helpers.
 *
 * App.jsx splits each route behind `React.lazy()`, so MangaPage,
 * AddPage, etc. are only fetched when the user actually navigates
 * to them. That's good for first-paint of the landing/dashboard,
 * but turns every "click on a manga card" into a network round-trip
 * for a 50-90 KB chunk + the second-render frame for the new
 * component to mount.
 *
 * These helpers let interaction surfaces (hover, focus, scroll into
 * view) trigger the import early so the chunk is already sitting
 * in Vite's module cache by the time the click lands. Subsequent
 * clicks navigate instantly because `lazy()` resolves synchronously
 * once the module has been imported once.
 *
 * Each helper is idempotent — repeated calls reuse the same in-flight
 * Promise and the resolved module is held by the browser's import
 * cache. Worst case: one redundant `import()` call that the JS engine
 * dedupes itself.
 */

let mangaPagePromise = null;

/**
 * Warm up the MangaPage chunk. Safe to call from `onMouseEnter` /
 * `onFocus` — fires the import the first time, returns the cached
 * Promise on every subsequent call.
 *
 * Doesn't await — fire-and-forget, the browser handles the rest.
 */
export function prefetchMangaPage() {
  if (mangaPagePromise) return mangaPagePromise;
  mangaPagePromise = import("@/components/MangaPage.jsx").catch((err) => {
    // Network drop / chunk-load failure: clear the cached promise
    // so a future user interaction can retry. Without this, a single
    // failed prefetch on slow Wi-Fi would prevent any future preload
    // attempt for the rest of the session.
    mangaPagePromise = null;
    if (typeof console !== "undefined") {
      console.debug("[prefetch] MangaPage chunk preload failed:", err?.message);
    }
  });
  return mangaPagePromise;
}
