import { useCallback, useMemo, useState } from "react";
import { useWindowGridVirtualizer } from "@/hooks/useWindowGridVirtualizer.js";

/**
 * 巻 · The volumes grid of one loose segment on MangaPage.
 *
 * Below `VIRTUALIZE_THRESHOLD` tiles this is exactly the CSS grid it
 * replaces — same classes, zero overhead, native auto-layout — because
 * for a 12-volume series nothing beats that. At or above it, rows are
 * windowed through `useWindowGridVirtualizer`: a 110-tome series mounts
 * ~30 tiles instead of 110, each a 900-line `Volume` with its own edit
 * form, cover and gesture handlers.
 *
 * Two things the library grid didn't have to care about:
 *   - `Volume` tiles carry transient state (an open edit form with
 *     draft price / store / note, an open loan modal). A tile that
 *     scrolls out of the overscan window unmounts and would lose that.
 *     Tiles report `onBusyChange(id, bool)`; the row holding a busy tile
 *     is pinned into the virtual range so it never unmounts mid-edit.
 *   - Two view modes with different lane counts. The breakpoint tables
 *     mirror the Tailwind classes of the simple-grid branch exactly.
 *
 * The parent keeps owning what a tile looks like: `renderTile(vol)`
 * returns the element for one volume, so this component knows nothing
 * about `Volume` / `VolumeShelfTile` props.
 */
export const VIRTUALIZE_THRESHOLD = 48;

// grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3
const LEDGER_LANES = [
  { min: 1024, lanes: 3 },
  { min: 640, lanes: 2 },
  { min: 0, lanes: 1 },
];
// grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6
const SHELF_LANES = [
  { min: 1024, lanes: 6 },
  { min: 768, lanes: 5 },
  { min: 640, lanes: 4 },
  { min: 0, lanes: 3 },
];

const LEDGER_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";
const SHELF_CLASS =
  "grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6";

export default function VirtualVolumeGrid({ vols, shelf, renderTile }) {
  if (vols.length < VIRTUALIZE_THRESHOLD) {
    return (
      <div className={shelf ? SHELF_CLASS : LEDGER_CLASS}>
        {vols.map((vol) => renderTile(vol, undefined))}
      </div>
    );
  }
  return <Virtualized vols={vols} shelf={shelf} renderTile={renderTile} />;
}

function Virtualized({ vols, shelf, renderTile }) {
  // id → busy. Kept as a Set in state so a change re-renders the grid
  // with an updated pinned range.
  const [busyIds, setBusyIds] = useState(() => new Set());
  const onBusyChange = useCallback((id, busy) => {
    setBusyIds((prev) => {
      if (prev.has(id) === busy) return prev;
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const laneBreakpoints = shelf ? SHELF_LANES : LEDGER_LANES;
  const indexById = useMemo(
    () => new Map(vols.map((v, i) => [v.id, i])),
    [vols],
  );

  // Busy tiles as item indexes; the hook maps them to rows itself,
  // since only it knows the current lane count.
  const pinnedItems = useMemo(() => {
    if (busyIds.size === 0) return [];
    const out = [];
    for (const id of busyIds) {
      const idx = indexById.get(id);
      if (idx != null) out.push(idx);
    }
    return out;
  }, [busyIds, indexById]);

  const { parentRef, lanes, scrollMargin, virtualizer } =
    useWindowGridVirtualizer({
      itemCount: vols.length,
      laneBreakpoints,
      // Ledger tiles are tall cards with an inline form; shelf tiles
      // are 2:3 spines. `measureElement` corrects per row after paint.
      estimateSize: shelf ? 220 : 180,
      overscan: 6,
      pinnedItems,
    });

  const gap = shelf ? "0.5rem" : "0.75rem"; // gap-2 / gap-3

  return (
    <div
      ref={parentRef}
      style={{
        height: virtualizer.getTotalSize(),
        position: "relative",
        width: "100%",
      }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const start = row.index * lanes;
        const rowVols = vols.slice(start, start + lanes);
        return (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${row.start - scrollMargin}px)`,
              display: "grid",
              gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))`,
              gap,
              paddingBottom: gap,
            }}
          >
            {rowVols.map((vol) => renderTile(vol, onBusyChange))}
          </div>
        );
      })}
    </div>
  );
}
