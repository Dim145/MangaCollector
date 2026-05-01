import Manga from "../Manga";
import VirtualMangaGrid, { VIRTUALIZE_THRESHOLD } from "./VirtualMangaGrid.jsx";

export default function MangaGrid({
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
  const gridClass = `grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 ${
    shelf3d && !selectionMode ? "shelf-3d" : ""
  }`;
  if (filtered.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className={gridClass}>
        {filtered.map((manga, i) => (
          <Manga
            // Custom series can share `mal_id = null` until the server
            // mints a negative id, so we prefer the Dexie primary key.
            key={manga.id ?? manga.mal_id ?? `idx-${i}`}
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
        ))}
      </div>
    );
  }
  return <VirtualMangaGrid filtered={filtered} {...cardProps} />;
}
