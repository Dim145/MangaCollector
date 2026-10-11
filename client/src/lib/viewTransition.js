/*
 * View Transitions API helpers.
 *
 * `document.startViewTransition()` captures the DOM before/after an
 * update, then morphs matching `view-transition-name` elements between
 * the two snapshots. Used here for two distinct cases:
 *
 *   1. **Opening a series from the library** — `navigateWithCover()`
 *      below. Not the router's `viewTransition: true` option: React
 *      Router only acts on it under a data router (`RouterProvider`),
 *      and this app mounts a `<BrowserRouter>`, where the option is
 *      accepted and ignored. Thirteen navigations asked for it and
 *      none ever had a transition.
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
 *
 * No callers wrap Dashboard's filter / lens / tag toggles anymore:
 * every variant we tried (default cross-fade, root opacity hard-
 * cut, view-transition-name: none, opaque-during-VT, transition-all
 * removal) either left the page chrome's translucent surfaces
 * (search bar, atmosphere) visibly darker mid-transition, or broke
 * the named-children animations / introduced a click-to-paint
 * latency. The Dashboard now hard-cuts those state changes — no
 * VT — and the helper survives only for places where the trade-off
 * lands favourably (e.g. drawers / sort ops where there's no
 * translucent chrome in the snapshot pair).
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

/**
 * 遷 · Navigate with a cover morphing into its counterpart on the next
 * page (the library card into the series page's hero).
 *
 * The router renders a navigation inside `startTransition`, which
 * `flushSync` does not flush, so the update callback cannot be
 * synchronous: it navigates, then resolves once an element carrying the
 * same `view-transition-name` is in the document — or after `waitMs`,
 * the screen holding the old frame meanwhile. The page's module is
 * normally loaded by then: the card preloads it on hover, focus and
 * touch.
 *
 * The name is put on the clicked cover alone, at the moment of the
 * click. Named statically, every card on the shelf became a layer of
 * its own in the browser's snapshot for the one that mattered.
 *
 * Falls back to a plain navigation where the API is missing. Under
 * `prefers-reduced-motion` the stylesheet keeps the cross-fade and
 * drops the movement (`styles/index.css`).
 */
export function navigateWithCover(navigate, to, options, { cover, name, waitMs = 450 } = {}) {
  if (
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function" ||
    !cover ||
    !name
  ) {
    navigate(to, options);
    return null;
  }
  cover.style.viewTransitionName = name;
  try {
    return document.startViewTransition(() => {
      // Captured already; two elements named alike would void the
      // "after" snapshot.
      cover.style.viewTransitionName = "";
      navigate(to, options);
      return arrivalOf(name, waitMs);
    });
  } catch {
    cover.style.viewTransitionName = "";
    navigate(to, options);
    return null;
  }
}

/** Resolves when an element named `name` is in the document, or after `waitMs`. */
export function arrivalOf(name, waitMs) {
  const present = () =>
    [...document.querySelectorAll("[style*='view-transition-name']")].some(
      (el) => el.style.viewTransitionName === name,
    );
  return new Promise((resolve) => {
    if (present()) {
      resolve();
      return;
    }
    // Rendering is held during the update callback, so no frame-based
    // polling: the DOM itself says when the page has mounted.
    const observer = new MutationObserver(() => {
      if (!present()) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve();
    }, waitMs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

