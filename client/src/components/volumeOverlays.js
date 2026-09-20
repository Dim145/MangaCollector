/**
 * 扉 · The two overlays a volume card opens: the detail drawer and the
 * loan sheet. Together they are the biggest thing on the series page
 * after the page itself, and a reader who is only looking at a shelf
 * opens neither — so they are fetched separately, during idle, rather
 * than parsed before the first tome can be drawn.
 *
 * Why this and not `React.lazy`: `lazy` suspends the first time it is
 * rendered even when the module is already in the browser's registry,
 * and React's retry after that suspension is scheduled, not immediate.
 * Measured on the series page, the first tap on a volume took 302 ms
 * to show the drawer that way, against 2 ms once resolved — a quarter
 * of a second of nothing, on the page's main interaction, for a module
 * that had finished downloading long before. Keeping the resolved
 * components in module scope removes the suspension entirely: by the
 * time a reader taps, `overlays()` returns them and the card renders
 * them like any other child.
 *
 * `MangaPage` calls `preloadVolumeOverlays` when it goes idle. A reader
 * fast enough to tap before that gets the same import, awaited by
 * `useVolumeOverlays`, and one extra render.
 */

let drawer = null;
let loanSheet = null;
let inFlight = null;

export function preloadVolumeOverlays() {
  inFlight ??= Promise.all([
    import("./VolumeDetailDrawer.jsx").then((m) => {
      drawer = m.default;
    }),
    import("./LoanModal.jsx").then((m) => {
      loanSheet = m.default;
    }),
  ]).catch((err) => {
    // 再 · Forget the failure. A chunk fetch fails for reasons that
    // pass — a tab left open across a deploy asking for a hash that no
    // longer exists, a tunnel, a dropped connection — and a memoised
    // rejection would answer every later tap with the same error, for
    // the life of the page. Clearing it lets the next tap try again.
    inFlight = null;
    throw err;
  });
  return inFlight;
}

/** The components, or `null` for each until they have arrived. */
export function volumeOverlays() {
  return { VolumeDetailDrawer: drawer, LoanModal: loanSheet };
}

/** Have both arrived? */
export function volumeOverlaysReady() {
  return Boolean(drawer && loanSheet);
}

/** Test seam. */
export function _resetVolumeOverlays() {
  drawer = null;
  loanSheet = null;
  inFlight = null;
}
