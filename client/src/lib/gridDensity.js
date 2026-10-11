/**
 * 密 · How many covers a row of the library holds.
 *
 * Two shapes, one source of truth. The grid renders through two paths —
 * plain Tailwind classes for a short library, a windowed grid for a long
 * one — and they have to agree on the column count at every breakpoint
 * or the page reflows when the virtualizer takes over. So the class
 * string and the lane table live here side by side, and a test parses
 * one against the other.
 */

export const DEFAULT_DENSITY = "comfortable";
export const DENSITIES = ["comfortable", "dense"];

/** Tailwind's own breakpoints, so the two paths agree by construction. */
const SCREENS = { sm: 640, md: 768, lg: 1024, xl: 1280 };

/**
 * Columns per breakpoint, largest first — the order
 * `laneCountForWidth` walks.
 */
const LANES = Object.freeze({
  comfortable: Object.freeze([
    { min: SCREENS.xl, lanes: 6 },
    { min: SCREENS.lg, lanes: 5 },
    { min: SCREENS.md, lanes: 4 },
    { min: SCREENS.sm, lanes: 3 },
    { min: 0, lanes: 2 },
  ]),
  dense: Object.freeze([
    { min: SCREENS.xl, lanes: 8 },
    { min: SCREENS.lg, lanes: 6 },
    { min: SCREENS.md, lanes: 5 },
    { min: SCREENS.sm, lanes: 4 },
    { min: 0, lanes: 3 },
  ]),
});

const CLASSES = Object.freeze({
  comfortable:
    "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
  dense:
    "grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8",
});

export function isDensity(value) {
  return DENSITIES.includes(value);
}

const safe = (density) => (isDensity(density) ? density : DEFAULT_DENSITY);

/** Stable identity per density — the virtualizer re-measures when it changes. */
export function laneTable(density) {
  return LANES[safe(density)];
}

/** The Tailwind grid classes for the non-windowed path. */
export function gridClassFor(density) {
  return CLASSES[safe(density)];
}

export function lanesForWidth(density, width) {
  for (const bp of laneTable(density)) {
    if (width >= bp.min) return bp.lanes;
  }
  return 1;
}

/** Tighter gutters when the covers are smaller. */
export function gapFor(density, lanes) {
  if (safe(density) === "dense") return lanes >= 5 ? "0.75rem" : "0.5rem";
  return lanes === 2 ? "0.75rem" : "1rem";
}

/**
 * The column counts the class string actually declares, as a lane table.
 * Only used by the test that keeps the two paths honest.
 */
export function lanesFromClassName(className) {
  const table = [];
  for (const m of className.matchAll(/(?:([a-z]+):)?grid-cols-(\d+)/g)) {
    const [, screen, cols] = m;
    table.push({ min: screen ? (SCREENS[screen] ?? NaN) : 0, lanes: +cols });
  }
  return table
    .filter((row) => Number.isFinite(row.min))
    .sort((a, b) => b.min - a.min);
}

/*
 * 寸 · How wide a cover is drawn at each breakpoint, as an `<img sizes>`
 * value — what lets the browser pick a cover's 256-pixel rendition on a
 * standard screen instead of the 512 one (`lib/covers.js`).
 *
 * Derived from the same lane table and the same class string as the
 * grid itself, gaps included, so the two cannot drift: the dashboard is
 * `max-w-7xl` (1280 px) with `px-4` / `sm:px-6`, and a tile is what is
 * left of that, minus the gaps, divided by the lanes. Above the
 * container's width the tile is a fixed number of pixels.
 */
const CONTAINER_PX = 1280;
const PADDING_PX = { base: 16, sm: 24 };

/** `[{ min, px }]`, widest breakpoint first, read off a grid's class string. */
export function gapsFromClassName(className) {
  const table = [];
  for (const m of className.matchAll(/(?:([a-z]+):)?gap-(\d+(?:\.\d+)?)(?=\s|$)/g)) {
    const [, screen, step] = m;
    table.push({ min: screen ? (SCREENS[screen] ?? NaN) : 0, px: Number(step) * 4 });
  }
  return table
    .filter((row) => Number.isFinite(row.min))
    .sort((a, b) => b.min - a.min);
}

function gapAt(gaps, width) {
  for (const row of gaps) if (width >= row.min) return row.px;
  return 0;
}

export function coverSizesFor(density) {
  const gaps = gapsFromClassName(gridClassFor(density));
  const parts = [];
  for (const { min, lanes } of laneTable(density)) {
    const pad = min >= SCREENS.sm ? PADDING_PX.sm : PADDING_PX.base;
    const fixed = 2 * pad + gapAt(gaps, min) * (lanes - 1);
    const size =
      min >= CONTAINER_PX
        ? `${Math.ceil((CONTAINER_PX - fixed) / lanes)}px`
        : `calc((100vw - ${fixed}px) / ${lanes})`;
    parts.push(min > 0 ? `(min-width: ${min}px) ${size}` : size);
  }
  return parts.join(", ");
}
