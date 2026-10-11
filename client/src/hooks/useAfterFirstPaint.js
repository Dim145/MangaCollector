import { startTransition, useEffect, useState } from "react";

/**
 * 後 · `false` for the first paint of the component that asks, `true`
 * once that paint is on screen — switched in a transition, so the work
 * it releases is rendered in slices the reader can interrupt.
 *
 * For a page whose first screen is a small part of what it renders: the
 * stats page drew its seven sections before its title could appear, and
 * styling and laying out all of them was most of the wait. It now draws
 * the title and the first section, then the rest.
 *
 * `requestAnimationFrame` runs just before a paint; the timeout queued
 * from it runs after that paint.
 */
export function useAfterFirstPaint() {
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    if (painted) return undefined;
    let timer = null;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => startTransition(() => setPainted(true)), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer != null) clearTimeout(timer);
    };
  }, [painted]);
  return painted;
}
