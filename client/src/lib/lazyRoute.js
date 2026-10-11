import { createElement, lazy, useState } from "react";

/**
 * 待 · A lazily loaded page that can be loaded *before* it is rendered —
 * and that then renders without suspending.
 *
 * `React.lazy` always suspends the first time it renders, even when its
 * module is already in memory: its factory runs at that render, and an
 * `import()` resolves a task later at best. On a first visit that
 * suspension commits the router's `<Suspense>` fallback, and React 19
 * then holds the page itself back until the fallback has been on screen
 * for 300 ms (`FALLBACK_THROTTLE_MS`, so that loading states do not
 * flicker). Measured on /stats at 4× CPU: the fallback at 190 ms, the
 * page at 492 ms, the main thread idle for most of the gap, waiting on
 * the timer. Every page paid it on every cold start.
 *
 * Here the module is imported once, by whichever comes first — the
 * boot preload (`main.jsx`, for the page the URL names), a link's
 * prefetch, or the render itself — and remembered. A render that finds
 * it renders the page directly; only one that does not falls back to
 * `React.lazy`, so a navigation to a page nobody prefetched still keeps
 * the previous page on screen while it loads, as before.
 *
 * Which of the two a mounted route uses is decided once, at mount:
 * switching from the lazy wrapper to the page itself would be a change
 * of element type, and React would remount the page and lose its state.
 *
 * A failed import is forgotten so the next attempt tries again; the
 * render path rethrows it to `RouteErrorBoundary`, as `React.lazy` did.
 *
 * `before` is loaded alongside the module and the page is ready only
 * once both are: the page's own translations (`routePages.js`), so its
 * first render never shows a raw key.
 */
export function lazyRoute(factory, { before } = {}) {
  let page = null;
  let pending = null;

  function load() {
    if (page) return Promise.resolve(page);
    if (!pending) {
      pending = Promise.all([factory(), before?.()]).then(
        ([mod]) => {
          page = mod.default;
          return page;
        },
        (error) => {
          pending = null;
          throw error;
        },
      );
    }
    return pending;
  }

  const Lazy = lazy(() => load().then((Page) => ({ default: Page })));

  function RoutePage(props) {
    const [Ready] = useState(() => page);
    return createElement(Ready ?? Lazy, props);
  }
  RoutePage.preload = load;
  RoutePage.isReady = () => page != null;
  return RoutePage;
}
