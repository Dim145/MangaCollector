import { useMemo } from "react";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";

/**
 * 収 · Year-in-review aggregations.
 *
 * Computes nine narrative metrics for the user's `year` of collecting,
 * derived purely from data already cached by `useLibrary()` +
 * `useAllVolumes()`. No new backend endpoint, no second round-trip —
 * matches the same client-side aggregation pattern as
 * `useProfileAnalytics.js`.
 *
 * Heuristic choices, identical to the rest of the analytics layer:
 *   - "Acquired in year YYYY" ≈ `volume.modified_on` (or `created_on`
 *     fallback) falling inside the YYYY calendar window, with
 *     `owned=true`. The activity log would be perfect but it's
 *     paginated and not always cached.
 *   - "Read in year YYYY" = `read_at` strictly inside the year.
 *   - "Series started in year" = the series whose FIRST owned volume
 *     was acquired in that year (and never owned anything earlier).
 *   - "Series completed in year" = series that hit
 *     volumes_owned == volumes for the FIRST time in that year. We
 *     approximate this by checking the last-owned volume of a
 *     currently-complete series falls inside the year.
 *
 * The shape is a stable `bundle` object so callers can destructure
 * without defensive checks. `loading` and `empty` (under five
 * volumes) are top-level flags so the page can render the right
 * surface without recomputing.
 */

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** Return the calendar year of an ISO timestamp (or null on bad input). */
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
  return new Date(t).getMonth(); // 0-11
}

/**
 * 季節 · Map a 0-11 month index to one of the four seasons.
 * Northern-hemisphere convention; the page layer is not personalised
 * by hemisphere because the year-in-review is a *content* surface
 * (not a UI ambient), and the southern-hemisphere user can read the
 * accent palette as "the page colour for the period when I bought
 * the most" rather than "the season I'm currently in".
 */
function seasonForMonth(monthIndex) {
  if (monthIndex == null) return "neutral";
  // 春 Mar-May, 夏 Jun-Aug, 秋 Sep-Nov, 冬 Dec-Feb
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

    // Map from mal_id to the library row for fast genre / image / name
    // lookup when annotating volume entries below.
    const byMalId = new Map(lib.map((m) => [m.mal_id, m]));

    // Volumes acquired in this calendar year — using modified_on
    // (with created_on fallback). Same convention as
    // useProfileAnalytics.
    const acquiredInYear = owned.filter((v) => {
      const y = yearOf(v.modified_on ?? v.created_on);
      return y === year;
    });

    // Read in this year (independent of when acquired — a borrowed
    // volume read this year still counts).
    const readInYear = vols.filter((v) => yearOf(v.read_at) === year);

    // ─── Headline number ────────────────────────────────────────────
    const volumesAcquired = acquiredInYear.length;
    const volumesRead = readInYear.length;

    // ─── Series started in year ─────────────────────────────────────
    // For each series, find the first owned volume across all years.
    // If that earliest owned-acquisition timestamp falls in `year`,
    // the series counts as "started this year".
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

    // ─── Series completed in year ───────────────────────────────────
    // A currently-complete series (volumes_owned >= volumes > 0) whose
    // most recent acquisition timestamp falls in `year` — that's our
    // best client-side approximation of "the year you closed the
    // series". A series completed in earlier years and untouched
    // since won't trigger this, which is correct for a year-in-review.
    let seriesCompleted = 0;
    for (const m of lib) {
      const total = Number(m.volumes) || 0;
      const ownedCount = Number(m.volumes_owned) || 0;
      if (total <= 0 || ownedCount < total) continue;
      // Find the most recent owned acquisition timestamp for this series.
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

    // ─── Total spent in year ────────────────────────────────────────
    let totalSpent = 0;
    for (const v of acquiredInYear) {
      const p = Number(v.price) || 0;
      if (p > 0) totalSpent += p;
    }

    // ─── Top genres of volumes acquired in year ────────────────────
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

    // ─── Best month (most volumes acquired) ─────────────────────────
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

    // ─── Top series this year ───────────────────────────────────────
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

    // ─── Bookends — first and last volumes of the year ──────────────
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

    // ─── Accent season ──────────────────────────────────────────────
    // Tied to the busiest month so each year's poster has a unique
    // dominant tone keyed to the user's actual rhythm.
    const accentSeason =
      bestMonth != null ? seasonForMonth(bestMonth.index) : "neutral";

    // The "empty" predicate decides whether the page renders the full
    // poster or a graceful "not enough story yet" surface. Five volumes
    // is enough to make the page meaningful without dropping the bar
    // so low that a brand-new user gets a stat-less ghost page.
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
