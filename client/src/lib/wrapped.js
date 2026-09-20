/**
 * 収 · What a period of collecting looked like.
 *
 * One pure function behind both the year poster and the monthly one:
 * the questions are the same ("how many tomes, which series, what did
 * it cost"), only the window changes. Everything is derived from the
 * rows already cached by `useLibrary()` and `useAllVolumes()` — a
 * wrapped costs no round trip and works offline.
 *
 * Acquisition timestamps use `modified_on ?? created_on`, the same
 * convention as `useProfileAnalytics.js`: the activity log would be
 * exact but is not always paginated into the cache.
 */

/**
 * How many tomes a period needs before it has anything to say. A year
 * with four tomes is a quiet year, not a story; a month with four is an
 * ordinary month, which is the whole point of a monthly recap.
 */
export const MIN_VOLUMES_YEAR = 5;
export const MIN_VOLUMES_MONTH = 3;

function stamp(volume) {
  return volume?.modified_on ?? volume?.created_on ?? null;
}

function parts(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return { year: d.getFullYear(), month: d.getMonth(), time: t };
}

/**
 * `month` is 0–11 for a single month, `null` for a whole year. Anything
 * else is read as a whole year: a bad URL segment shows the year rather
 * than an error.
 */
export function normalizeMonth(month) {
  // `Number(null)` and `Number(false)` are both 0, which would quietly
  // turn "the whole year" into January — the one value a caller passes
  // when it means no month at all.
  if (typeof month !== "number" && typeof month !== "string") return null;
  // And `Number("")` is 0 as well — an empty select value is "no month".
  if (typeof month === "string" && month.trim() === "") return null;
  const n = Number(month);
  return Number.isInteger(n) && n >= 0 && n <= 11 ? n : null;
}

/** The month before `{year, month}`, wrapping to December of the year before. */
export function previousMonth(year, month) {
  return month === 0
    ? { year: year - 1, month: 11 }
    : { year, month: month - 1 };
}

function inPeriodAt(time, year, month) {
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === year && (month == null || d.getMonth() === month);
}

function inPeriod(iso, year, month) {
  const p = parts(iso);
  if (!p) return false;
  return inPeriodAt(p.time, year, month);
}

// Northern-hemisphere mapping; used purely to pick an accent palette,
// never to state a fact about the reader's seasons.
export function seasonForMonth(monthIndex) {
  if (monthIndex == null) return "neutral";
  if (monthIndex >= 2 && monthIndex <= 4) return "spring";
  if (monthIndex >= 5 && monthIndex <= 7) return "summer";
  if (monthIndex >= 8 && monthIndex <= 10) return "autumn";
  return "winter";
}

function genresOf(series) {
  const raw =
    typeof series?.genres === "string"
      ? series.genres.split(",")
      : Array.isArray(series?.genres)
        ? series.genres
        : [];
  return raw.map((g) => String(g).trim()).filter(Boolean);
}

/**
 * Everything a poster shows for one period.
 *
 * `month: null` is the year; `0–11` is that month of that year.
 */
export function summarisePeriod(library, volumes, { year, month = null } = {}) {
  const lib = Array.isArray(library) ? library : [];
  const vols = Array.isArray(volumes) ? volumes : [];
  const monthIndex = normalizeMonth(month);
  const owned = vols.filter((v) => v?.owned);
  const byMalId = new Map(lib.map((m) => [m.mal_id, m]));

  const acquired = owned.filter((v) => inPeriod(stamp(v), year, monthIndex));
  const read = vols.filter((v) => inPeriod(v?.read_at, year, monthIndex));
  const volumesAcquired = acquired.length;

  // A series counts as started when its earliest owned tome — across
  // every year, not just this one — lands inside the period.
  const earliestOwned = new Map();
  for (const v of owned) {
    const p = parts(stamp(v));
    if (!p) continue;
    const cur = earliestOwned.get(v.mal_id);
    if (cur == null || p.time < cur) earliestOwned.set(v.mal_id, p.time);
  }
  let seriesStarted = 0;
  for (const time of earliestOwned.values()) {
    if (inPeriodAt(time, year, monthIndex)) seriesStarted += 1;
  }

  // "Completed in this period" is approximated: a series complete
  // *today* whose most recent acquisition fell inside it.
  const latestOwned = new Map();
  for (const v of owned) {
    const p = parts(stamp(v));
    if (!p) continue;
    const cur = latestOwned.get(v.mal_id);
    if (cur == null || p.time > cur) latestOwned.set(v.mal_id, p.time);
  }
  let seriesCompleted = 0;
  for (const m of lib) {
    const total = Number(m.volumes) || 0;
    const have = Number(m.volumes_owned) || 0;
    if (total <= 0 || have < total) continue;
    const latest = latestOwned.get(m.mal_id);
    if (latest == null) continue;
    if (inPeriodAt(latest, year, monthIndex)) seriesCompleted += 1;
  }

  let totalSpent = 0;
  for (const v of acquired) {
    const p = Number(v.price) || 0;
    if (p > 0) totalSpent += p;
  }

  const genreCount = new Map();
  for (const v of acquired) {
    for (const g of genresOf(byMalId.get(v.mal_id))) {
      genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
    }
  }
  const topGenres = [...genreCount.entries()]
    .map(([name, count]) => ({
      name,
      count,
      share: volumesAcquired > 0 ? count / volumesAcquired : 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3);

  // The busiest month only means something across a whole year.
  const monthCounts = new Array(12).fill(0);
  for (const v of acquired) {
    const p = parts(stamp(v));
    if (p) monthCounts[p.month] += 1;
  }
  let bestMonth = null;
  if (monthIndex == null) {
    let index = -1;
    let count = 0;
    for (let i = 0; i < 12; i += 1) {
      if (monthCounts[i] > count) {
        count = monthCounts[i];
        index = i;
      }
    }
    if (index >= 0) bestMonth = { index, count };
  }

  // A month compares against the one before it — the single number a
  // monthly recap has that a yearly one does not.
  let previous = null;
  if (monthIndex != null) {
    const prev = previousMonth(year, monthIndex);
    const count = owned.filter((v) =>
      inPeriod(stamp(v), prev.year, prev.month),
    ).length;
    previous = { ...prev, count, delta: volumesAcquired - count };
  }

  const perSeries = new Map();
  for (const v of acquired) {
    perSeries.set(v.mal_id, (perSeries.get(v.mal_id) ?? 0) + 1);
  }
  let topSeries = null;
  for (const [malId, count] of perSeries.entries()) {
    if (topSeries && count <= topSeries.count) continue;
    const series = byMalId.get(malId);
    if (!series) continue;
    topSeries = {
      mal_id: malId,
      name: series.name ?? "—",
      cover: series.image_url_jpg ?? null,
      count,
    };
  }

  const ordered = [...acquired].sort(
    (a, b) => (parts(stamp(a))?.time ?? 0) - (parts(stamp(b))?.time ?? 0),
  );
  const bookend = (v) => {
    if (!v) return null;
    const series = byMalId.get(v.mal_id);
    return {
      mal_id: v.mal_id,
      vol_num: v.vol_num,
      date: stamp(v),
      seriesName: series?.name ?? "—",
      cover: series?.image_url_jpg ?? null,
    };
  };

  const floor = monthIndex == null ? MIN_VOLUMES_YEAR : MIN_VOLUMES_MONTH;

  return {
    year,
    month: monthIndex,
    empty: volumesAcquired < floor,
    volumesAcquired,
    volumesRead: read.length,
    seriesStarted,
    seriesCompleted,
    totalSpent,
    topGenres,
    bestMonth,
    previous,
    topSeries,
    firstVolume: bookend(ordered[0]),
    lastVolume: bookend(ordered[ordered.length - 1]),
    accentSeason:
      monthIndex != null
        ? seasonForMonth(monthIndex)
        : bestMonth
          ? seasonForMonth(bestMonth.index)
          : "neutral",
  };
}
