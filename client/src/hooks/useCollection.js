import { useMemo } from "react";
import { computeLibraryStats } from "@/utils/libraryStats.js";

/**
 * 出版 / 版 · Filter the user's library by a free-text attribute
 * (publisher OR edition). Pure client computation — both columns
 * live in Dexie via the regular `useLibrary` cache, so this never
 * needs a server endpoint or a dedicated query.
 *
 * Match policy: case-insensitive, trimmed equality on the column.
 * Empty / null target returns an empty array (the route param
 * should never reach this in normal navigation; defensive).
 *
 * Returns:
 *   - `matches`   — library rows whose `publisher` (or `edition`)
 *                   equals the target, sorted by name
 *   - `displayName` — the canonical casing from the first match
 *                     (so "Glénat" surfaces even if the URL was
 *                     lowercased by a copy-paste)
 *   - `stats`     — `{ seriesCount, totalVolumes, totalOwned,
 *                      completionPct, topGenres }`
 *                   where `topGenres` is sorted by frequency.
 *                   Genres are aggregated for both kinds (a
 *                   publisher's catalog has a content fingerprint;
 *                   an edition's catalog also reads as one when
 *                   shown alongside the posters).
 */
export function useCollection({ kind, name, library }) {
  const targetField = kind === "edition" ? "edition" : "publisher";
  const target = (name ?? "").trim().toLowerCase();

  const matches = useMemo(() => {
    if (!target || !Array.isArray(library)) return [];
    return library
      .filter((m) => {
        const v = m?.[targetField];
        return (
          typeof v === "string" &&
          v.trim().toLowerCase() === target
        );
      })
      .sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "", undefined, {
          sensitivity: "base",
        }),
      );
  }, [library, target, targetField]);

  const displayName = useMemo(() => {
    if (matches.length > 0) {
      const v = matches[0]?.[targetField];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    return (name ?? "").trim();
  }, [matches, name, targetField]);

  const stats = useMemo(() => computeLibraryStats(matches), [matches]);

  return { matches, displayName, stats };
}
