import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db.js";

/**
 * 作家 Sakka · Distinct list of mangaka / authors the user has in
 * their library — pulled from every entry in the Dexie `library`
 * cache. Series are grouped by author so the result can drive both
 * the autocomplete on the edit form AND the per-author detail page
 * (`/author/:malId`).
 *
 * Author data lives on `row.author` as `{ id, mal_id, name }` (the
 * embedded AuthorRef the server emits via FK enrichment). Rows with
 * `author = null` are series whose FK is unset — skipped here.
 *
 * Mirrors `useKnownStores` / `useKnownPublishers`:
 *   - dedupe by `author.id` (the FK target, the only stable key)
 *   - display form is `author.name` from the latest row seen
 *   - count is the number of series attributed to that author
 *
 * Returns `[{ id, mal_id, name, count, mal_ids }]` sorted by
 * `count DESC, name ASC`, so the most-collected mangaka surface
 * first in autocomplete and dashboard chips. `mal_ids` is the list
 * of MANGA mal_ids attributed to that author (used by callers that
 * want to deep-link into the affected series).
 */
export function useKnownAuthors() {
  const library = useLiveQuery(() => db.library.toArray(), []);

  return useMemo(() => {
    const buckets = new Map();

    for (const row of library ?? []) {
      const author = row?.author;
      if (!author?.id) continue;
      const key = author.id;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          id: author.id,
          mal_id: author.mal_id,
          name: author.name,
          count: 0,
          mal_ids: [],
        };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (row.mal_id != null) bucket.mal_ids.push(row.mal_id);
    }

    return Array.from(buckets.values()).sort(
      (a, b) =>
        b.count - a.count ||
        (a.name ?? "").localeCompare(b.name ?? "", undefined, {
          sensitivity: "base",
        }),
    );
  }, [library]);
}
