/*
 * 鏡 · What the shelf can be narrowed and ordered by, shared by the
 * dashboard's own rows and popovers (from `sm:` up) and the filter sheet
 * a phone gets instead of them (`FiltersSheet.jsx`).
 */

export const SORT_LABEL_KEYS = {
  title: "dashboard.sortByTitle",
  added: "dashboard.sortByAdded",
  updated: "dashboard.sortByUpdated",
  progress: "dashboard.sortByProgress",
  missing: "dashboard.sortByMissing",
  owned: "dashboard.sortByOwned",
  author: "dashboard.sortByAuthor",
  upcoming: "dashboard.sortByUpcoming",
};

// Time-based lenses — mutually exclusive with the status tabs, see the
// `lens` state in `Dashboard.jsx` for what each one keeps.
export const LENSES = [
  {
    id: "recent",
    glyph: "新",
    labelKey: "dashboard.lensRecent",
    hintKey: "dashboard.lensRecentHint",
    accent: "moegi",
  },
  {
    id: "sleeping",
    glyph: "眠",
    labelKey: "dashboard.lensSleeping",
    hintKey: "dashboard.lensSleepingHint",
    accent: "washi",
  },
  {
    id: "wishlist_aged",
    glyph: "慕",
    labelKey: "dashboard.lensWishlistAged",
    hintKey: "dashboard.lensWishlistAgedHint",
    accent: "sakura",
  },
];

/**
 * Every genre on the shelf with the number of series carrying it, most
 * common first, then alphabetical. Counted over the whole library so
 * picking a tag never reshuffles its neighbours.
 */
export function tagCounts(library) {
  const counts = new Map();
  for (const m of library ?? []) {
    for (const g of m.genres ?? []) {
      const name = (g ?? "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}
