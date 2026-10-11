import { useEffect, useRef, useState } from "react";

/*
 * 遅 · IntersectionObserver-based lazy loading for covers + posters.
 *
 * Why this on top of native `loading="lazy"`:
 *   - Native lazy fires when the image is in (or very near) the
 *     viewport. Some browsers use a tight margin on mobile, which
 *     means a fast scroll past a row can show the LQIP swatch for
 *     several frames before the cover starts loading. Our 200px
 *     `rootMargin` schedules the fetch BEFORE the row reaches the
 *     fold so the cover is usually ready by the time the user sees
 *     the slot.
 *   - We can gate the `<img>` element entirely on the visibility
 *     signal — the request is never even queued for off-screen rows
 *     in a virtualized grid, which keeps bandwidth proportional to
 *     what the user actually scrolls through.
 *
 * 共 · One observer per `rootMargin` for the whole page, not one per
 * image: a windowed grid keeps 30 to 60 covers mounted, and each used to
 * own an observer of its own for as long as it waited.
 *
 * `enabled: false` is for an image that is needed now — the first row,
 * the LCP candidate. It is "near" from its first render, so its request
 * starts with the commit instead of a frame later, when an observer
 * would have reported it.
 *
 * Falls back to "always near" (effectively eager-load) on browsers
 * without IntersectionObserver, where native `loading="lazy"` on the
 * `<img>` itself is the safety net.
 */
const pools = new Map();

function poolFor(rootMargin) {
  let pool = pools.get(rootMargin);
  // Keyed on the constructor too, so a test that swaps the global
  // observer gets a pool built from the one it installed.
  if (pool && pool.ctor === IntersectionObserver) return pool;
  const callbacks = new WeakMap();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        if (!callback) continue;
        callbacks.delete(entry.target);
        observer.unobserve(entry.target);
        callback();
      }
    },
    { rootMargin },
  );
  pool = { observer, callbacks, ctor: IntersectionObserver };
  pools.set(rootMargin, pool);
  return pool;
}

export function useLazyImage({ rootMargin = "200px", enabled = true } = {}) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  const near = seen || !enabled;

  useEffect(() => {
    if (near) return; // Already armed — the pool lets go of it below.
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // Very old browser — accept the load now and rely on native
      // `loading="lazy"` to defer the actual fetch until the row
      // reaches the visibility threshold.
      setSeen(true);
      return;
    }
    const { observer, callbacks } = poolFor(rootMargin);
    callbacks.set(el, () => setSeen(true));
    observer.observe(el);
    return () => {
      callbacks.delete(el);
      observer.unobserve(el);
    };
  }, [near, rootMargin]);

  return { ref, near };
}
