/**
 * 補 · Which series to offer completing, and which volumes are missing.
 *
 * Pure, so it can be tested without React Query or Dexie: the hook
 * (`useGapSuggestions`) only feeds it the two tables.
 *
 * Two kinds of series are left out, and both are about not asking a
 * reader for something they cannot do:
 *
 *   - an edition the reader marked **discontinued**. Its volume count
 *     still comes from MyAnimeList, which counts the Japanese original,
 *     so a French run stopped at ten of twenty-five reads as fifteen
 *     missing volumes — fifteen books nobody will ever print. Concluded
 *     and paused editions stay: those gaps are real and fillable.
 *   - volumes the reader deliberately skipped (`wanted === false`).
 *     A tome nobody wants is not a gap; counting it keeps a shelf
 *     permanently at 94 %.
 */

/** Volumes of `malId` the reader owns, as a set of numbers. */
function ownedByMal(volumes) {
  const index = new Map();
  for (const v of volumes) {
    if (!v.owned) continue;
    if (!index.has(v.mal_id)) index.set(v.mal_id, new Set());
    index.get(v.mal_id).add(v.vol_num);
  }
  return index;
}

/** Volumes of `malId` the reader has said they do not want. */
function skippedByMal(volumes) {
  const index = new Map();
  for (const v of volumes) {
    if (v.wanted !== false) continue;
    if (!index.has(v.mal_id)) index.set(v.mal_id, new Set());
    index.get(v.mal_id).add(v.vol_num);
  }
  return index;
}

export function gapSuggestions(library, volumes, limit = 4) {
  if (!library?.length) return [];
  const owned = ownedByMal(volumes ?? []);
  const skipped = skippedByMal(volumes ?? []);

  const suggestions = [];
  for (const m of library) {
    if (m.publication_status === "stopped") continue;
    const total = m.volumes ?? 0;
    if (total <= 0) continue;

    const has = owned.get(m.mal_id) ?? new Set();
    const not = skipped.get(m.mal_id) ?? new Set();
    const missing = [];
    for (let i = 1; i <= total; i += 1) {
      if (!has.has(i) && !not.has(i)) missing.push(i);
    }
    if (!missing.length) continue;

    suggestions.push({ manga: m, missing, gap: missing.length });
  }

  suggestions.sort((a, b) => a.gap - b.gap);
  return suggestions.slice(0, limit);
}

/**
 * 飛 · How many tomes of each series the reader has chosen to skip.
 *
 * The count matters beyond the gap list: a run of twelve with two
 * skipped is a run of ten as far as the reader is concerned, so that
 * is the number the percentage and the 完 filter have to divide by.
 * Owning the other ten should read as finished, not as 83 %.
 */
export function skippedCounts(volumes) {
  const counts = new Map();
  for (const v of volumes ?? []) {
    if (v.wanted !== false) continue;
    counts.set(v.mal_id, (counts.get(v.mal_id) ?? 0) + 1);
  }
  return counts;
}

/** The volumes of `series` the reader actually wants. */
export function wantedVolumes(series, skipped = 0) {
  return Math.max(0, (series?.volumes ?? 0) - skipped);
}

/** Does the reader hold every tome they want of this series? */
export function seriesIsComplete(series, skipped = 0) {
  const target = wantedVolumes(series, skipped);
  return target > 0 && (series?.volumes_owned ?? 0) >= target;
}
