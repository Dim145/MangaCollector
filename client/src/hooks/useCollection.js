import { useMemo } from "react";

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

  const stats = useMemo(() => computeStats(matches), [matches]);

  return { matches, displayName, stats };
}

function computeStats(matches) {
  if (matches.length === 0) {
    return {
      seriesCount: 0,
      totalVolumes: 0,
      totalOwned: 0,
      completionPct: 0,
      topGenres: [],
    };
  }
  let totalVolumes = 0;
  let totalOwned = 0;
  const genreFreq = new Map();
  for (const m of matches) {
    totalVolumes += m.volumes ?? 0;
    totalOwned += m.volumes_owned ?? 0;
    for (const g of m.genres ?? []) {
      const trimmed = String(g).trim();
      if (!trimmed) continue;
      genreFreq.set(trimmed, (genreFreq.get(trimmed) ?? 0) + 1);
    }
  }
  const completionPct =
    totalVolumes > 0 ? Math.round((totalOwned / totalVolumes) * 100) : 0;
  const topGenres = Array.from(genreFreq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([n, c]) => ({ name: n, count: c }));
  return {
    seriesCount: matches.length,
    totalVolumes,
    totalOwned,
    completionPct,
    topGenres,
  };
}
