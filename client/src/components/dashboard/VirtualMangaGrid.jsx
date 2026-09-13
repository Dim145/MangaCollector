import { useWindowGridVirtualizer } from "@/hooks/useWindowGridVirtualizer.js";
import { gapFor, laneTable } from "@/lib/gridDensity.js";
import { useGridDensity } from "@/hooks/useGridDensity.js";
import Manga from "../Manga";

/**
 * 格 · Manga grid — switches between a classic CSS grid and a
 * windowed virtualizer based on item count.
 *
 * Below `VIRTUALIZE_THRESHOLD` items the simple grid wins on every
 * axis: zero overhead, native CSS grid auto-layout, no reflow on
 * resize. Above threshold, virtualization caps the rendered DOM at
 * the viewport plus an overscan buffer, which is what keeps the
 * Dashboard responsive at 500+ series.
 *
 * Two careful design choices for the virtualized path:
 *   - Generous `overscan` (8 rows ≈ 30+ cards). View Transitions API
 *     needs the source element rendered at the moment the navigation
 *     starts — Cmd+K's "scroll to + click" sequence fires the route
 *     change before the scroll's RAF settles, so we keep extra rows
 *     above and below the viewport so the source card is in the DOM
 *     for the cross-route morph.
 *   - Responsive lanes computed from `window.innerWidth` rather than
 *     leaning on Tailwind's `grid-cols-*` classes. Each virtualized
 *     row needs to know exactly how many cards to render, and the
 *     library's `useVirtualizer` doesn't introspect CSS — so we drop
 *     the responsive utility classes here and use inline
 *     `gridTemplateColumns: repeat(${lanes}, ...)`.
 *
 * Lane / scroll-margin bookkeeping lives in `useWindowGridVirtualizer`,
 * shared with the volumes grid on MangaPage, so the two windowed grids
 * can't drift apart.
 */
export const VIRTUALIZE_THRESHOLD = 100;
export default function VirtualMangaGrid({
  filtered,
  adult_content_level,
  allCollectorSet,
  tsundokuByMal,
  nextUpcomingByMal,
  selectionMode,
  selectedIds,
  onToggleSelect,
  onEnterSelection,
  shelf3d,
}) {
  const { density } = useGridDensity();
  const { parentRef, lanes, scrollMargin, virtualizer } =
    useWindowGridVirtualizer({
      itemCount: filtered.length,
      laneBreakpoints: laneTable(density),
      estimateSize: 270,
      // 8 rows * up to 6 cols = 48 cards buffer above/below the
      // viewport. Comfortably covers the "Cmd+K → navigate" race
      // condition where View Transitions need the source card to
      // still be rendered when the route change fires.
      overscan: 8,
    });

  return (
    <div
      ref={parentRef}
      style={{
        height: virtualizer.getTotalSize(),
        position: "relative",
        width: "100%",
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const start = virtualRow.index * lanes;
        const rowItems = filtered.slice(start, start + lanes);
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            // Per-row 3D class — applies the same tilt + wood-grain
            // baseline as the simple grid's `.shelf-3d` does. Skipped
            // in selection mode for the same reason as the simple
            // path: tilted cards fight the selection ring overlay.
            className={shelf3d && !selectionMode ? "shelf-3d" : undefined}
            // Position rows in document coordinates (window virtualizer
            // measures against window.scrollY, then we subtract the
            // grid's own offset to translate inside the parent).
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              display: "grid",
              gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))`,
              // Match the simple grid's gap for this density.
              gap: gapFor(density, lanes),
              // Bottom padding equal to gap so the last row of a row
              // doesn't run flush against the next section.
              paddingBottom: gapFor(density, lanes),
            }}
          >
            {rowItems.map((manga, i) => (
              <Manga
                key={manga.id ?? manga.mal_id ?? `idx-${start + i}`}
                manga={manga}
                adult_content_level={adult_content_level}
                allCollector={allCollectorSet.has(manga.mal_id)}
                tsundokuCount={tsundokuByMal.get(manga.mal_id) ?? 0}
                nextUpcoming={nextUpcomingByMal.get(manga.mal_id)}
                selectionMode={selectionMode}
                isSelected={selectedIds.has(manga.mal_id)}
                onToggleSelect={onToggleSelect}
                onEnterSelection={onEnterSelection}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
