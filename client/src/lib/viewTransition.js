/*
 * View Transitions API helpers.
 *
 * `document.startViewTransition()` captures the DOM before/after a
 * synchronous update, then morphs matching `view-transition-name`
 * elements between the two snapshots. Used here for two distinct
 * cases:
 *
 *   1. **Cross-route navigation** — handled by React Router 7 directly
 *      via the `viewTransition: true` option on `navigate()` / `<Link>`.
 *      No helper needed; the router already calls
 *      `startViewTransition(() => flushSync(...))` under the hood.
 *
 *   2. **Same-route DOM updates** (filter reorder, drawer mount, list
 *      sort) — wrap the state setter in `withViewTransition()`.
 *      `flushSync` is mandatory so the post-update DOM is visible to
 *      the snapshot inside the same microtask.
 *
 * Browser support: Chrome 111+, Edge 111+, Safari 18+, Firefox 142+.
 * Older browsers fall through to a plain synchronous call — the page
 * updates instantly without a transition, which is the existing
 * behaviour and therefore a strict subset.
 *
 * Reduced-motion preference is honoured at CSS level (see
 * `@media (prefers-reduced-motion: reduce) ::view-transition-*` in
 * `styles/index.css`); the JS path always runs so the DOM update
 * lands either way — only the animation gets suppressed.
 */
import { flushSync } from "react-dom";

/**
 * Run `updateFn` inside a View Transition when supported.
 *
 * `updateFn` MUST mutate state synchronously — anything still in a
 * `useEffect` won't be captured by the "after" snapshot, and the
 * transition will animate from "before" to "before" (i.e. nothing
 * visible). React's `flushSync` ensures the update + re-render flush
 * before the snapshot.
 *
 * Returns the `ViewTransition` object on supported browsers (so
 * callers can `await transition.finished` for chaining), or `null`
 * on unsupported browsers / SSR.
 */
export function withViewTransition(updateFn) {
  if (
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function"
  ) {
    updateFn();
    return null;
  }
  return document.startViewTransition(() => {
    flushSync(updateFn);
  });
}

/**
 * Convenience helper: build the `view-transition-name` for a series
 * cover so Dashboard and MangaPage agree on the same name without
 * stringly-typed mistakes. Names must be unique per page; using the
 * series' `mal_id` (always populated, possibly negative for custom
 * entries) gives one canonical name per series.
 */
export function coverTransitionName(mal_id) {
  if (mal_id == null) return undefined;
  return `cover-${mal_id}`;
}
