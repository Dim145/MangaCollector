import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultRangeExtractor,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import { markScrollAdjustment } from "@/lib/scrollAdjusting.js";

/**
 * 寸 · Row heights learnt by measurement, kept across mounts.
 *
 * Keyed by grid, lane count and viewport width — the three things a
 * row's height depends on in a uniform grid — so the library grid
 * mounting again after a series page starts from the truth rather than
 * from the caller's guess. Module state on purpose: it must outlive the
 * component, and a page reload is allowed to start from the guess.
 */
const rowHeightMemory = new Map();

/**
 * 直 · The window virtualizer's scroll function, with one change: a
 * correction is instant.
 *
 * TanStack moves the window when a row *above* the viewport turns out
 * taller than estimated, so the content in view stays put. It passes no
 * `behavior` for that, and the stylesheet's `html { scroll-behavior:
 * smooth }` then animates it — a visible drift of a few dozen pixels,
 * fighting whatever the reader (or a scroll restore) is doing. Only an
 * explicit behaviour is kept; a correction nobody asked for is instant.
 */
export function instantWindowScroll(offset, { adjustments = 0, behavior }, instance) {
  const win = instance.scrollElement;
  if (!win?.scrollTo) return;
  // Say so, so the library's scroll memory does not mistake this for
  // the reader choosing a position — see `lib/scrollAdjusting.js`.
  markScrollAdjustment();
  win.scrollTo({
    [instance.options.horizontal ? "left" : "top"]: offset + adjustments,
    behavior: behavior ?? "instant",
  });
}

/**
 * 格 · Window-scrolled, lane-based row virtualizer shared by the grids
 * that render hundreds of tiles (the library on the Dashboard, the
 * volumes of a long series on MangaPage).
 *
 * Handles the things every such grid needs and used to copy:
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
 *     mid-edit is one of those items;
 *   - the row height. `estimateSize` is only the first paint's guess:
 *     every row of one of these grids is the same height, so the first
 *     row measured is the truth for all of them, and it is remembered
 *     (per grid, lane count and viewport width) for the next mount.
 *     This matters more than it looks. A stale estimate makes the
 *     document too short to hold a scroll position in the grid's tail —
 *     and the rows there are only measured once rendered, which needs
 *     the scroll first. Coming back to a series near the bottom of the
 *     library waited the restore's full 1.5 s cap for that reason, then
 *     descended in three hops as rows were measured. With the estimate
 *     exact from the first paint the layout is the same whether a row
 *     has been measured or not, the position is holdable at once, and
 *     TanStack never has to correct the scroll.
 *
 * Attach `measureRow` (not `virtualizer.measureElement`) as each row's
 * `ref`: it is what records the height before delegating.
 *
 * @param {object} opts
 * @param {number} opts.itemCount
 * @param {{min:number,lanes:number}[]} opts.laneBreakpoints — sorted by `min` desc
 * @param {number} opts.estimateSize — row height guess in px, for a grid never measured
 * @param {number} [opts.overscan=6]
 * @param {Iterable<number>} [opts.pinnedItems]
 * @param {string} [opts.memoryKey] — names the grid in the row-height
 *        memory; without it the height learnt lives for this mount only
 */
export function useWindowGridVirtualizer({
  itemCount,
  laneBreakpoints,
  estimateSize,
  overscan = 6,
  pinnedItems,
  memoryKey,
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

  // The row height measured on this mount, if any. A lane change makes
  // rows a different height, so it starts over (the memory may still
  // know the new lane count from an earlier mount).
  const measuredRowRef = useRef(null);
  const lanesRef = useRef(lanes);
  if (lanesRef.current !== lanes) {
    lanesRef.current = lanes;
    measuredRowRef.current = null;
  }
  const memoryId =
    memoryKey && typeof window !== "undefined"
      ? `${memoryKey}|${lanes}|${window.innerWidth}`
      : null;

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
    estimateSize: () =>
      measuredRowRef.current ??
      (memoryId ? rowHeightMemory.get(memoryId) : undefined) ??
      estimateSize,
    overscan,
    scrollMargin,
    rangeExtractor,
    scrollToFn: instantWindowScroll,
  });

  const measureRow = useCallback(
    (node) => {
      if (node) {
        // Measured the way TanStack measures it (`offsetHeight`, whole
        // pixels), so the height learnt and the per-row measurements
        // agree exactly — a fraction of difference would be a scroll
        // correction on every row.
        const height = virtualizer.options.measureElement(
          node,
          undefined,
          virtualizer,
        );
        if (height > 0) {
          measuredRowRef.current = height;
          if (memoryId) rowHeightMemory.set(memoryId, height);
        }
      }
      virtualizer.measureElement(node);
    },
    [virtualizer, memoryId],
  );

  return { parentRef, lanes, rowCount, scrollMargin, virtualizer, measureRow };
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

/** Test seam. */
export function _resetRowHeightMemory() {
  rowHeightMemory.clear();
}
