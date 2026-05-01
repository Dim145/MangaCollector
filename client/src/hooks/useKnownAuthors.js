import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db.js";

/**
 * 作家 Sakka · Distinct list of mangaka / authors the user has in
 * their library — pulled from every entry in the Dexie `library`
 * cache. Series are grouped by author so the result can drive both
 * the autocomplete on the edit form AND the per-author detail page
 * (`/author/:name`).
 *
 * Mirrors `useKnownStores` / `useKnownPublishers`:
 *   - case-folded dedupe ("Sui Ishida" / "sui ishida" → one entry)
 *   - display form preserves the casing of the FIRST occurrence
 *   - count is the number of series attributed to that author
 *
 * Returns `[{ name, count, mal_ids }]` sorted by `count DESC, name ASC`,
 * so the most-collected mangaka surface first in autocomplete and
 * dashboard chips.
 */
export function useKnownAuthors() {
  const library = useLiveQuery(() => db.library.toArray(), []);

  return useMemo(() => {
    const counts = new Map();
    const displays = new Map();
    const malIds = new Map();

    for (const row of library ?? []) {
      const trimmed = (row?.author ?? "").trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!displays.has(key)) displays.set(key, trimmed);
      if (!malIds.has(key)) malIds.set(key, []);
      if (row.mal_id != null) malIds.get(key).push(row.mal_id);
    }

    return Array.from(counts.entries())
      .map(([key, count]) => ({
        name: displays.get(key),
        count,
        mal_ids: malIds.get(key) ?? [],
      }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
  }, [library]);
}
