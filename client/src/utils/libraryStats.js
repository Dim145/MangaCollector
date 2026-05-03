/**
 * 統計 · Single source of truth for "library aggregate stats".
 *
 * Three near-identical copies used to live in `SnapshotsPage`,
 * `useCollection`, and `AuthorPage`. They diverged on which fields
 * they emitted and on the `topGenres` cap (5 vs. 6). Centralising
 * here lets each caller pick the cap and only the fields they need.
 *
 * Returned shape:
 *   {
 *     seriesCount,      // number of distinct series in the input
 *     totalVolumes,     // sum of `volumes`
 *     totalOwned,       // sum of `volumes_owned`
 *     seriesComplete,   // count of series with volumes_owned >= volumes (and volumes > 0)
 *     completionPct,    // round((totalOwned / totalVolumes) * 100), 0 when totalVolumes is 0
 *     topGenres,        // sorted [{ name, count }] capped at `topGenresLimit`
 *   }
 *
 * `topGenres` counts at the SERIES level — "genres this corpus
 * touches", not "genres weighted by volume count". `name`s are
 * trimmed; empty strings dropped.
 */
export function computeLibraryStats(rows, { topGenresLimit = 6 } = {}) {
  const list = Array.isArray(rows) ? rows : [];

  let totalVolumes = 0;
  let totalOwned = 0;
  let seriesComplete = 0;
  const genreFreq = new Map();

  for (const m of list) {
    const v = m?.volumes ?? 0;
    const o = m?.volumes_owned ?? 0;
    totalVolumes += v;
    totalOwned += o;
    if (v > 0 && o >= v) seriesComplete += 1;
    for (const g of m?.genres ?? []) {
      const trimmed = String(g).trim();
      if (!trimmed) continue;
      genreFreq.set(trimmed, (genreFreq.get(trimmed) ?? 0) + 1);
    }
  }

  const completionPct =
    totalVolumes > 0 ? Math.round((totalOwned / totalVolumes) * 100) : 0;

  const topGenres = Array.from(genreFreq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topGenresLimit)
    .map(([name, count]) => ({ name, count }));

  return {
    seriesCount: list.length,
    totalVolumes,
    totalOwned,
    seriesComplete,
    completionPct,
    topGenres,
  };
}
