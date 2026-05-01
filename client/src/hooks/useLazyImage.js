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
 * Falls back to "always near" (effectively eager-load) on browsers
 * without IntersectionObserver, where native `loading="lazy"` on the
 * `<img>` itself is the safety net.
 */
export function useLazyImage({ rootMargin = "200px" } = {}) {
  const ref = useRef(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return; // Already armed — observer disconnects below.
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // Very old browser — accept the load now and rely on native
      // `loading="lazy"` to defer the actual fetch until the row
      // reaches the visibility threshold.
      setNear(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near, rootMargin]);

  return { ref, near };
}
