import { useMemo } from "react";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";

/**
 * Year-in-review aggregations derived from the data already cached by
 * `useLibrary()` and `useAllVolumes()` — no extra round-trip.
 *
 * Acquisition timestamps use `modified_on ?? created_on`, the same
 * convention as `useProfileAnalytics.js` (the activity log would be
 * exact but isn't always paginated into the cache).
 */

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function yearOf(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t).getFullYear();
}

function monthOf(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t).getMonth();
}

// Northern-hemisphere mapping; the page uses this purely to pick an
// accent palette tied to the user's busiest month.
function seasonForMonth(monthIndex) {
  if (monthIndex == null) return "neutral";
  if (monthIndex >= 2 && monthIndex <= 4) return "spring";
  if (monthIndex >= 5 && monthIndex <= 7) return "summer";
  if (monthIndex >= 8 && monthIndex <= 10) return "autumn";
  return "winter";
}

export function useYearInReview(year) {
  const { data: library, isInitialLoad: libLoading } = useLibrary();
  const { data: volumes, isInitialLoad: volLoading } = useAllVolumes();

  const loading = libLoading || volLoading;

  const bundle = useMemo(() => {
    const lib = library ?? [];
    const vols = volumes ?? [];
    const owned = vols.filter((v) => v.owned);

    const byMalId = new Map(lib.map((m) => [m.mal_id, m]));

    const acquiredInYear = owned.filter((v) => {
      const y = yearOf(v.modified_on ?? v.created_on);
      return y === year;
    });
    const readInYear = vols.filter((v) => yearOf(v.read_at) === year);

    const volumesAcquired = acquiredInYear.length;
    const volumesRead = readInYear.length;

    // A series counts as "started this year" when its earliest owned
    // volume across all years falls inside `year`.
    const earliestOwnedByMal = new Map();
    for (const v of owned) {
      const ts = new Date(v.modified_on ?? v.created_on).getTime();
      if (Number.isNaN(ts)) continue;
      const cur = earliestOwnedByMal.get(v.mal_id);
      if (cur == null || ts < cur) earliestOwnedByMal.set(v.mal_id, ts);
    }
    let seriesStarted = 0;
    for (const ts of earliestOwnedByMal.values()) {
      if (new Date(ts).getFullYear() === year) seriesStarted += 1;
    }

    // "Completed this year" is approximated by a currently-complete
    // series whose most recent acquisition falls in `year`.
    let seriesCompleted = 0;
    for (const m of lib) {
      const total = Number(m.volumes) || 0;
      const ownedCount = Number(m.volumes_owned) || 0;
      if (total <= 0 || ownedCount < total) continue;
      let latest = -Infinity;
      for (const v of owned) {
        if (v.mal_id !== m.mal_id) continue;
        const ts = new Date(v.modified_on ?? v.created_on).getTime();
        if (!Number.isNaN(ts) && ts > latest) latest = ts;
      }
      if (Number.isFinite(latest) && new Date(latest).getFullYear() === year) {
        seriesCompleted += 1;
      }
    }

    let totalSpent = 0;
    for (const v of acquiredInYear) {
      const p = Number(v.price) || 0;
      if (p > 0) totalSpent += p;
    }

    const genreCount = new Map();
    for (const v of acquiredInYear) {
      const series = byMalId.get(v.mal_id);
      if (!series) continue;
      const raw =
        typeof series.genres === "string"
          ? series.genres.split(",")
          : Array.isArray(series.genres)
            ? series.genres
            : [];
      for (const g of raw) {
        const trimmed = String(g).trim();
        if (!trimmed) continue;
        genreCount.set(trimmed, (genreCount.get(trimmed) ?? 0) + 1);
      }
    }
    const topGenres = Array.from(genreCount.entries())
      .map(([name, count]) => ({
        name,
        count,
        share: volumesAcquired > 0 ? count / volumesAcquired : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const monthCounts = new Array(12).fill(0);
    for (const v of acquiredInYear) {
      const m = monthOf(v.modified_on ?? v.created_on);
      if (m != null) monthCounts[m] += 1;
    }
    let bestMonthIndex = -1;
    let bestMonthCount = 0;
    for (let i = 0; i < 12; i += 1) {
      if (monthCounts[i] > bestMonthCount) {
        bestMonthCount = monthCounts[i];
        bestMonthIndex = i;
      }
    }
    const bestMonth =
      bestMonthIndex >= 0
        ? {
            index: bestMonthIndex,
            key: MONTH_KEYS[bestMonthIndex],
            count: bestMonthCount,
            label: new Date(year, bestMonthIndex, 1).toLocaleDateString(
              undefined,
              { month: "long" },
            ),
          }
        : null;

    const seriesAcquiredCount = new Map();
    for (const v of acquiredInYear) {
      seriesAcquiredCount.set(
        v.mal_id,
        (seriesAcquiredCount.get(v.mal_id) ?? 0) + 1,
      );
    }
    let topSeries = null;
    let topSeriesCount = 0;
    for (const [malId, count] of seriesAcquiredCount.entries()) {
      if (count > topSeriesCount) {
        topSeriesCount = count;
        const series = byMalId.get(malId);
        if (series) {
          topSeries = {
            mal_id: malId,
            name: series.name ?? "—",
            cover: series.image_url_jpg ?? null,
            count,
          };
        }
      }
    }

    const sortedAcquired = [...acquiredInYear].sort((a, b) => {
      const ta = new Date(a.modified_on ?? a.created_on).getTime();
      const tb = new Date(b.modified_on ?? b.created_on).getTime();
      return ta - tb;
    });
    function annotateBookend(v) {
      if (!v) return null;
      const series = byMalId.get(v.mal_id);
      return {
        mal_id: v.mal_id,
        vol_num: v.vol_num,
        date: v.modified_on ?? v.created_on,
        seriesName: series?.name ?? "—",
        cover: series?.image_url_jpg ?? null,
      };
    }
    const firstVolume = annotateBookend(sortedAcquired[0]);
    const lastVolume = annotateBookend(
      sortedAcquired[sortedAcquired.length - 1],
    );

    const accentSeason =
      bestMonth != null ? seasonForMonth(bestMonth.index) : "neutral";

    // Five volumes is the floor below which the page falls back to an
    // empty-state message.
    const empty = volumesAcquired < 5;

    return {
      year,
      empty,
      volumesAcquired,
      volumesRead,
      seriesStarted,
      seriesCompleted,
      totalSpent,
      topGenres,
      bestMonth,
      topSeries,
      firstVolume,
      lastVolume,
      accentSeason,
    };
  }, [library, volumes, year]);

  return { bundle, loading };
}
