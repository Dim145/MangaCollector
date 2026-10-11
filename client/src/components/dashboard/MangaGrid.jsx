import { memo } from "react";
import Manga from "../Manga";
import VirtualMangaGrid, { VIRTUALIZE_THRESHOLD } from "./VirtualMangaGrid.jsx";
import { coverSizesFor, gridClassFor, lanesForWidth } from "@/lib/gridDensity.js";
import { useGridDensity } from "@/hooks/useGridDensity.js";

function MangaGrid({
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
  // 先 · True when this shelf is the one a fresh visit opens on — its
  // first covers are then worth preloading next time.
  recordLcp = false,
  // What the list is, for a screen reader ("Your series").
  label,
}) {
  const { density } = useGridDensity();
  const cardProps = {
    adult_content_level,
    allCollectorSet,
    tsundokuByMal,
    nextUpcomingByMal,
    selectionMode,
    selectedIds,
    onToggleSelect,
    onEnterSelection,
    shelf3d,
  };
  // 棚 · The `.shelf-3d` class adds perspective + per-card tilt +
  // wood-grain shadow ribs, layered on top of the existing grid.
  // Selection mode forces flat (the tilt would fight the selection
  // ring + checkbox overlay for visual priority).
  const gridClass = `${gridClassFor(density)} ${
    shelf3d && !selectionMode ? "shelf-3d" : ""
  }`;
  // 寸 · The slot's width for the covers' `sizes`, and the first row —
  // the covers the shelf opens on, its LCP — loaded at once.
  const coverSizes = coverSizesFor(density);
  if (filtered.length <= VIRTUALIZE_THRESHOLD) {
    const firstRow =
      typeof window === "undefined"
        ? 2
        : lanesForWidth(density, window.innerWidth);
    return (
      <div role="list" aria-label={label} className={gridClass}>
        {filtered.map((manga, i) => (
          <div
            // Custom series can share `mal_id = null` until the server
            // mints a negative id, so we prefer the Dexie primary key.
            key={manga.id ?? manga.mal_id ?? `idx-${i}`}
            role="listitem"
            aria-setsize={filtered.length}
            aria-posinset={i + 1}
            className="min-w-0"
          >
          <Manga
            coverSizes={coverSizes}
            priority={i < firstRow}
            lcpHintRank={recordLcp && i < 2 ? i : undefined}
            manga={manga}
            adult_content_level={cardProps.adult_content_level}
            allCollector={cardProps.allCollectorSet.has(manga.mal_id)}
            tsundokuCount={cardProps.tsundokuByMal.get(manga.mal_id) ?? 0}
            nextUpcoming={cardProps.nextUpcomingByMal.get(manga.mal_id)}
            selectionMode={selectionMode}
            isSelected={selectedIds.has(manga.mal_id)}
            onToggleSelect={onToggleSelect}
            onEnterSelection={onEnterSelection}
          />
          </div>
        ))}
      </div>
    );
  }
  return (
    <VirtualMangaGrid
      filtered={filtered}
      coverSizes={coverSizes}
      recordLcp={recordLcp}
      label={label}
      {...cardProps}
    />
  );
}

/**
 * 記憶 · Memoize the grid itself so it re-renders only when its
 * own props change. Dashboard re-renders on every keystroke into
 * the search input; without memo, that would force the grid to
 * rebuild its 200+ children on every char typed even though the
 * filtered slice and the lookup Maps are stable until the user
 * actually mutates the library. Combined with the per-card
 * `memo()` on `<Manga>`, the typing path stays at O(filter pass)
 * instead of O(filter pass + N card re-renders).
 */
export default memo(MangaGrid);
