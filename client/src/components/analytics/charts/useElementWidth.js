import { useLayoutEffect, useRef, useState } from "react";

/**
 * 幅 · The width of an element, kept current by a `ResizeObserver` —
 * what the charts draw against (their height is fixed by the page).
 * Read once in a layout effect so the first frame already has it.
 */
export function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect?.width ?? el.clientWidth);
      setWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
