import { useMemo } from "react";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";

/**
 * Derive the full analytics bundle for /profile from the library + volumes
 * already fetched by the page. Everything is computed client-side — no new
 * backend endpoint, no extra round-trip. Returns the same shape every time
 * the inputs change so components can destructure without defensive checks.
 *
 * Heuristic choices worth noting:
 *   - "Purchase date" ≈ `volume.modified_on` (closest signal we have; we'd
 *     need the activity log to be perfect but it's paginated).
 *   - "Genre" comes from the comma-joined string on the library row, which
 *     we split back into an array here.
 *   - "Middle gaps" = owned volumes with at least one unowned volume sitting
 *     strictly between them. Trailing gaps (vol 5 owned, vol 6 missing, vol
 *     7 never bought) are ignored — those are the normal "waiting for next
 *     volume" state, not an actionable gap.
 *   - "Stale series" = ongoing (not complete) with its most recent owned
 *     volume > 6 months old. Ignores series with no owned volumes.
 */

const VOLUME_MILESTONES = [
  10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
];
const SERIES_MILESTONES = [5, 10, 25, 50, 100, 250, 500, 1000];
const STALE_THRESHOLD_MS = 180 * 24 * 60 * 60 * 1000; // ~6 months

function monthKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(d, n) {
  const nd = new Date(d);
  nd.setMonth(nd.getMonth() + n);
  return nd;
}

function formatMonthLabel(key) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function nextMilestone(value, thresholds) {
  for (const t of thresholds) if (t > value) return t;
  return null;
}

export function useProfileAnalytics() {
  const { data: library, isInitialLoad: libLoading } = useLibrary();
  const { data: volumes, isInitialLoad: volLoading } = useAllVolumes();

  const loading = libLoading || volLoading;

  const bundle = useMemo(() => {
    const lib = library ?? [];
    const vols = volumes ?? [];
    const owned = vols.filter((v) => v.owned);

    // ─── index helpers ────────────────────────────────────────────
    const byMalId = new Map(lib.map((m) => [m.mal_id, m]));

    // ─── monthly spending (last 12 months) ───────────────────────
    const now = new Date();
    const buckets = new Map();
    for (let i = 11; i >= 0; i -= 1) {
      const d = addMonths(now, -i);
      const key = monthKey(d);
      if (key) buckets.set(key, { month: key, label: formatMonthLabel(key), amount: 0, count: 0 });
    }
    let totalSpent = 0;
    let totalOwnedWithPrice = 0;
    for (const v of owned) {
      const p = Number(v.price) || 0;
      if (p > 0) {
        totalSpent += p;
        totalOwnedWithPrice += 1;
      }
      const key = monthKey(v.modified_on ?? v.created_on);
      if (!key) continue;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.amount += p;
        bucket.count += 1;
      }
    }
    const monthlySpending = Array.from(buckets.values());
    const avgPricePerVolume =
      totalOwnedWithPrice > 0 ? totalSpent / totalOwnedWithPrice : 0;

    // ─── series-add cadence (distinct series per month) ──────────
    const seriesBuckets = new Map();
    for (let i = 11; i >= 0; i -= 1) {
      const d = addMonths(now, -i);
      const key = monthKey(d);
      if (key) seriesBuckets.set(key, { month: key, label: formatMonthLabel(key), count: 0 });
    }
    for (const m of lib) {
      const key = monthKey(m.created_on);
      if (!key) continue;
      const bucket = seriesBuckets.get(key);
      if (bucket) bucket.count += 1;
    }
    const seriesCadence = Array.from(seriesBuckets.values());

    // ─── store breakdown ─────────────────────────────────────────
    const storeMap = new Map();
    for (const v of owned) {
      const s = (v.store ?? "").trim();
      if (!s) continue;
      const key = s.toLowerCase();
      const row = storeMap.get(key) ?? { name: s, count: 0, amount: 0 };
      row.count += 1;
      row.amount += Number(v.price) || 0;
      storeMap.set(key, row);
    }
    const storeBreakdown = Array.from(storeMap.values()).sort(
      (a, b) => b.count - a.count,
    );

    // ─── genre breakdown (by OWNED volumes) ──────────────────────
    const genreMap = new Map();
    for (const v of owned) {
      const series = byMalId.get(v.mal_id);
      const raw = typeof series?.genres === "string" ? series.genres : "";
      const genres = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const unique = [...new Set(genres)];
      for (const g of unique) {
        genreMap.set(g, (genreMap.get(g) ?? 0) + 1);
      }
    }
    const genreBreakdown = Array.from(genreMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // ─── collector insights ──────────────────────────────────────
    const collectorVols = owned.filter((v) => v.collector);
    const normalVols = owned.filter((v) => !v.collector);
    const sumAvg = (arr) => {
      const priced = arr.filter((v) => Number(v.price) > 0);
      if (!priced.length) return 0;
      return priced.reduce((s, v) => s + Number(v.price), 0) / priced.length;
    };
    const collectorCount = collectorVols.length;
    const collectorRatio =
      owned.length > 0 ? (collectorCount / owned.length) * 100 : 0;
    const collectorAvg = sumAvg(collectorVols);
    const normalAvg = sumAvg(normalVols);
    const collectorPremiumPct =
      normalAvg > 0 ? ((collectorAvg - normalAvg) / normalAvg) * 100 : null;

    // ─── coffret savings ─────────────────────────────────────────
    // Compare avg paid/vol inside coffrets vs avg paid/vol outside. We store
    // the per-volume slice of the coffret total on user_volumes.price, so a
    // simple average works without joining the coffret table.
    const coffretVols = owned.filter((v) => v.coffret_id != null);
    const looseVols = owned.filter((v) => v.coffret_id == null);
    const coffretAvg = sumAvg(coffretVols);
    const looseAvg = sumAvg(looseVols);
    const coffretSavingsPerVol = looseAvg > 0 ? looseAvg - coffretAvg : 0;
    const coffretSavingsTotal =
      coffretSavingsPerVol > 0 ? coffretSavingsPerVol * coffretVols.length : 0;
    const distinctCoffretCount = new Set(
      coffretVols.map((v) => v.coffret_id),
    ).size;

    // ─── next milestone ──────────────────────────────────────────
    const ownedVolumeCount = owned.length;
    const seriesCount = lib.length;
    const nextVolumeMilestone = nextMilestone(ownedVolumeCount, VOLUME_MILESTONES);
    const nextSeriesMilestone = nextMilestone(seriesCount, SERIES_MILESTONES);

    // ─── middle gaps (actionable "finish these volumes") ─────────
    // Series where the user owns vol N and vol N+k (k≥2) but is missing at
    // least one volume strictly between them. Trailing gaps (past the last
    // owned volume) are not counted — those are the "waiting for next vol".
    const volsByMal = new Map();
    for (const v of vols) {
      if (!volsByMal.has(v.mal_id)) volsByMal.set(v.mal_id, []);
      volsByMal.get(v.mal_id).push(v);
    }
    const middleGaps = [];
    for (const series of lib) {
      const seriesVols = volsByMal.get(series.mal_id) ?? [];
      const ownedNums = seriesVols
        .filter((v) => v.owned)
        .map((v) => v.vol_num)
        .sort((a, b) => a - b);
      if (ownedNums.length < 2) continue;
      const first = ownedNums[0];
      const last = ownedNums[ownedNums.length - 1];
      const missing = [];
      for (let n = first + 1; n < last; n += 1) {
        if (!ownedNums.includes(n)) missing.push(n);
      }
      if (missing.length > 0) {
        middleGaps.push({
          mal_id: series.mal_id,
          name: series.name,
          image_url_jpg: series.image_url_jpg,
          missing,
          ownedCount: ownedNums.length,
        });
      }
    }
    middleGaps.sort((a, b) => b.missing.length - a.missing.length);

    // ─── stale series (no new volume in 6+ months, not complete) ─
    const stale = [];
    for (const series of lib) {
      const total = series.volumes ?? 0;
      const got = series.volumes_owned ?? 0;
      if (total > 0 && got >= total) continue;
      if (got === 0) continue;
      const seriesVols = volsByMal.get(series.mal_id) ?? [];
      const ownedVols = seriesVols.filter((v) => v.owned);
      if (!ownedVols.length) continue;
      const lastTs = Math.max(
        ...ownedVols.map((v) =>
          new Date(v.modified_on ?? v.created_on ?? 0).getTime(),
        ),
      );
      if (!Number.isFinite(lastTs)) continue;
      const ageMs = Date.now() - lastTs;
      if (ageMs < STALE_THRESHOLD_MS) continue;
      stale.push({
        mal_id: series.mal_id,
        name: series.name,
        image_url_jpg: series.image_url_jpg,
        ownedCount: got,
        totalCount: total,
        lastActivityTs: lastTs,
        monthsSince: Math.floor(ageMs / (30 * 24 * 60 * 60 * 1000)),
      });
    }
    stale.sort((a, b) => a.lastActivityTs - b.lastActivityTs);

    return {
      totals: {
        totalSpent,
        avgPricePerVolume,
        seriesCount,
        ownedVolumeCount,
      },
      monthly: {
        spending: monthlySpending,
        series: seriesCadence,
      },
      composition: {
        stores: storeBreakdown,
        genres: genreBreakdown,
      },
      collector: {
        count: collectorCount,
        ratio: collectorRatio,
        avgPrice: collectorAvg,
        normalAvgPrice: normalAvg,
        premiumPct: collectorPremiumPct,
      },
      coffret: {
        distinctCount: distinctCoffretCount,
        volumeCount: coffretVols.length,
        avgPrice: coffretAvg,
        looseAvgPrice: looseAvg,
        savingsPerVol: coffretSavingsPerVol,
        savingsTotal: coffretSavingsTotal,
      },
      milestones: {
        nextVolume: nextVolumeMilestone,
        nextSeries: nextSeriesMilestone,
        ownedVolumeCount,
        seriesCount,
      },
      middleGaps: middleGaps.slice(0, 8),
      stale: stale.slice(0, 6),
    };
  }, [library, volumes]);

  return { ...bundle, loading };
}
