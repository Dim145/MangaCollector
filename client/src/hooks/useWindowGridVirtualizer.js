import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultRangeExtractor,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";

/**
 * 格 · Window-scrolled, lane-based row virtualizer shared by the grids
 * that render hundreds of tiles (the library on the Dashboard, the
 * volumes of a long series on MangaPage).
 *
 * Handles the three things every such grid needs and used to copy:
 *   - responsive lane count from `window.innerWidth`, since the row
 *     virtualizer can't introspect Tailwind's `grid-cols-*`;
 *   - `scrollMargin` — the grid's offset in document coordinates — so
 *     virtual rows are positioned against `window.scrollY`. It is
 *     re-measured not only on resize but whenever the DOCUMENT changes
 *     height (a `ResizeObserver` on `documentElement`): anything above
 *     the grid that expands or collapses would otherwise leave every
 *     row translated by a stale offset;
 *   - `pinnedItems` — item indexes that must stay mounted regardless of
 *     the viewport. Mapped to rows here (only this hook knows the lane
 *     count) and spliced into the range through `rangeExtractor`. A tile
 *     mid-edit is one of those items.
 *
 * @param {object} opts
 * @param {number} opts.itemCount
 * @param {{min:number,lanes:number}[]} opts.laneBreakpoints — sorted by `min` desc
 * @param {number} opts.estimateSize — row height estimate in px
 * @param {number} [opts.overscan=6]
 * @param {Iterable<number>} [opts.pinnedItems]
 */
export function useWindowGridVirtualizer({
  itemCount,
  laneBreakpoints,
  estimateSize,
  overscan = 6,
  pinnedItems,
}) {
  const parentRef = useRef(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [lanes, setLanes] = useState(() =>
    typeof window !== "undefined"
      ? laneCountForWidth(window.innerWidth, laneBreakpoints)
      : laneBreakpoints[laneBreakpoints.length - 1].lanes,
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let raf = null;
    const measure = () => {
      raf = null;
      setLanes(laneCountForWidth(window.innerWidth, laneBreakpoints));
      const el = parentRef.current;
      if (el) setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    const schedule = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    window.addEventListener("resize", schedule);
    // Document height changes (a section above collapsing, images
    // settling, a banner appearing) move the grid without a resize.
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule)
        : null;
    ro?.observe(document.documentElement);
    return () => {
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [laneBreakpoints]);

  const rowCount = Math.ceil(itemCount / lanes);
  const pinned = rowsForItems(pinnedItems, lanes, rowCount);
  const pinnedKey = pinned.join(",");

  const rangeExtractor = useCallback(
    (range) => {
      const base = defaultRangeExtractor(range);
      if (!pinned.length) return base;
      const set = new Set(base);
      for (const r of pinned) set.add(r);
      return [...set].sort((a, b) => a - b);
    },
    // `pinnedKey` is the stable serialisation of `pinned`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pinnedKey],
  );

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
    rangeExtractor,
  });

  return { parentRef, lanes, rowCount, scrollMargin, virtualizer };
}

export function laneCountForWidth(width, breakpoints) {
  for (const bp of breakpoints) {
    if (width >= bp.min) return bp.lanes;
  }
  return breakpoints[breakpoints.length - 1].lanes;
}

/**
 * Rows (sorted, deduplicated) that hold the given item indexes for a
 * grid of `lanes` columns; out-of-range items are dropped.
 */
export function rowsForItems(items, lanes, rowCount) {
  if (!items) return [];
  const rows = new Set();
  for (const idx of items) {
    if (!Number.isInteger(idx) || idx < 0) continue;
    const row = Math.floor(idx / lanes);
    if (row < rowCount) rows.add(row);
  }
  return [...rows].sort((a, b) => a - b);
}
