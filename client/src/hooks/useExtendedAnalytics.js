import { useMemo } from "react";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";

/**
 * 帳 · Extended analytics bundle for the deep-dive StatsPage.
 *
 * Layered on top of `useProfileAnalytics` — same Dexie inputs, same
 * client-side derivation, no new fetches. Kept separate so the
 * shorter ProfilePage hero only pulls what it actually shows.
 *
 * Returns:
 *   - authors             top-N by owned volumes (with completion %)
 *   - publishers          top-N by owned volumes + per-publisher completion
 *   - readingDelay        avg days from add → first read across read volumes
 *   - dokuhaRatio         { read, total } — series fully read vs fully owned
 *   - topVolumePrices     top-5 most expensive owned volumes
 *   - basketEvolution     monthly avg price of newly-added volumes
 *   - bestQuarter         { key, label, count } — quarter with most events
 *   - anniversary         { since, days, firstSeries } — time-tracking stat
 */

const TOP_LIMIT = 8;

function quarterKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function quarterLabel(key, lang) {
  const [y, q] = key.split("-Q");
  const monthIdx = (Number(q) - 1) * 3;
  // Sample the first month of the quarter to render a localised name.
  const d = new Date(Number(y), monthIdx, 1);
  const month = d.toLocaleDateString(
    lang === "fr" ? "fr-FR" : lang === "es" ? "es-ES" : "en-US",
    { month: "long" },
  );
  return `Q${q} ${y} · ${month}…`;
}

function monthKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(key) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export function useExtendedAnalytics({ lang = "en" } = {}) {
  const { data: library, isInitialLoad: libLoading } = useLibrary();
  const { data: volumes, isInitialLoad: volLoading } = useAllVolumes();

  const loading = libLoading || volLoading;

  const bundle = useMemo(() => {
    const lib = library ?? [];
    const vols = volumes ?? [];
    const owned = vols.filter((v) => v.owned);

    const byMalId = new Map(lib.map((m) => [m.mal_id, m]));

    // ─── 1 & 2 — top authors / publishers ────────────────────────
    // Walk owned volumes, attribute each to its series' author /
    // publisher. Empty / unknown values bucketed as "—" and dropped
    // before sorting so the rail doesn't get flooded with blanks.
    const authorAgg = new Map();
    const publisherAgg = new Map();
    for (const v of owned) {
      const series = byMalId.get(v.mal_id);
      if (!series) continue;
      // Series stats — used by the per-author/publisher completion %.
      // Pre-cache to avoid recomputing on every volume.
      const seriesTotal = series.volumes ?? 0;
      const seriesOwned = series.volumes_owned ?? 0;

      const authorName = series.author?.name?.trim();
      if (authorName) {
        const bucket = authorAgg.get(authorName) ?? {
          name: authorName,
          author_id: series.author?.id ?? null,
          author_mal_id: series.author?.mal_id ?? null,
          ownedVolumes: 0,
          seriesIds: new Set(),
          seriesTotalVols: 0,
          seriesOwnedVols: 0,
          posters: new Set(),
        };
        bucket.ownedVolumes += 1;
        if (!bucket.seriesIds.has(series.mal_id)) {
          bucket.seriesIds.add(series.mal_id);
          bucket.seriesTotalVols += seriesTotal;
          bucket.seriesOwnedVols += seriesOwned;
          if (series.image_url_jpg) bucket.posters.add(series.image_url_jpg);
        }
        authorAgg.set(authorName, bucket);
      }

      const publisher = series.publisher?.trim();
      if (publisher) {
        const bucket = publisherAgg.get(publisher) ?? {
          name: publisher,
          ownedVolumes: 0,
          seriesIds: new Set(),
          seriesTotalVols: 0,
          seriesOwnedVols: 0,
          posters: new Set(),
        };
        bucket.ownedVolumes += 1;
        if (!bucket.seriesIds.has(series.mal_id)) {
          bucket.seriesIds.add(series.mal_id);
          bucket.seriesTotalVols += seriesTotal;
          bucket.seriesOwnedVols += seriesOwned;
          if (series.image_url_jpg) bucket.posters.add(series.image_url_jpg);
        }
        publisherAgg.set(publisher, bucket);
      }
    }
    const finaliseAgg = (agg) =>
      Array.from(agg.values())
        .map((b) => ({
          name: b.name,
          author_id: b.author_id ?? null,
          author_mal_id: b.author_mal_id ?? null,
          ownedVolumes: b.ownedVolumes,
          seriesCount: b.seriesIds.size,
          completionPct:
            b.seriesTotalVols > 0
              ? Math.round((b.seriesOwnedVols / b.seriesTotalVols) * 100)
              : 0,
          posters: Array.from(b.posters).slice(0, 4),
        }))
        .sort((a, b) => b.ownedVolumes - a.ownedVolumes || a.name.localeCompare(b.name))
        .slice(0, TOP_LIMIT);
    const authors = finaliseAgg(authorAgg);
    const publishers = finaliseAgg(publisherAgg);

    // ─── 3 — average delay between adding a volume and reading it ─
    // Heuristic: `volume.modified_on` is the best "this volume's
    // last touch" signal we have; if it predates `read_at`, treat
    // it as the add-time. We bucket only *positive* deltas so a
    // volume that was added already-read (back-fill) doesn't pull
    // the average down.
    let delaySumMs = 0;
    let delaySamples = 0;
    for (const v of vols) {
      if (!v.read_at) continue;
      const series = byMalId.get(v.mal_id);
      const addTs = series?.created_on
        ? new Date(series.created_on).getTime()
        : v.modified_on
          ? new Date(v.modified_on).getTime()
          : null;
      if (addTs == null || Number.isNaN(addTs)) continue;
      const readTs = new Date(v.read_at).getTime();
      if (Number.isNaN(readTs)) continue;
      const delta = readTs - addTs;
      if (delta <= 0) continue; // skip back-fills
      delaySumMs += delta;
      delaySamples += 1;
    }
    const readingDelay = {
      samples: delaySamples,
      avgMs: delaySamples > 0 ? Math.round(delaySumMs / delaySamples) : null,
      avgDays:
        delaySamples > 0
          ? Math.round(delaySumMs / delaySamples / (1000 * 60 * 60 * 24))
          : null,
    };

    // ─── 4 — dokuha ratio (series fully read vs fully owned) ─────
    // A series is "fully owned" when volumes_owned >= volumes && volumes > 0.
    // It is "fully read" when every owned volume of that series has a read_at.
    const ownedBySeries = new Map();
    for (const v of vols) {
      if (!v.owned) continue;
      const arr = ownedBySeries.get(v.mal_id) ?? [];
      arr.push(v);
      ownedBySeries.set(v.mal_id, arr);
    }
    let fullyOwnedCount = 0;
    let fullyReadCount = 0;
    for (const m of lib) {
      if ((m.volumes ?? 0) <= 0) continue;
      if ((m.volumes_owned ?? 0) < (m.volumes ?? 0)) continue;
      fullyOwnedCount += 1;
      const ownedVols = ownedBySeries.get(m.mal_id) ?? [];
      // Edge case: legacy rows where `volumes_owned >= volumes` but
      // the Dexie volumes cache lags behind. Demand at least one
      // owned vol on file before claiming "fully read".
      if (ownedVols.length === 0) continue;
      const allRead = ownedVols.every((v) => !!v.read_at);
      if (allRead) fullyReadCount += 1;
    }
    const dokuhaRatio = {
      read: fullyReadCount,
      total: fullyOwnedCount,
      pct:
        fullyOwnedCount > 0
          ? Math.round((fullyReadCount / fullyOwnedCount) * 100)
          : 0,
    };

    // ─── 5 — top 5 most expensive volumes ────────────────────────
    const topVolumePrices = owned
      .filter((v) => typeof v.price === "number" && v.price > 0)
      .sort((a, b) => b.price - a.price)
      .slice(0, 5)
      .map((v) => {
        const series = byMalId.get(v.mal_id);
        return {
          id: v.id,
          mal_id: v.mal_id,
          vol_num: v.vol_num,
          price: v.price,
          store: v.store ?? null,
          series_name: series?.name ?? "—",
          image_url: series?.image_url_jpg ?? null,
          collector: !!v.collector,
        };
      });

    // ─── 6 — basket evolution: avg price of volumes added per month ─
    // Uses `modified_on` as the add-time stamp; volumes without a
    // valid price are skipped. The rolling 12-month window mirrors
    // the existing SpendingChart so the eye reads them as siblings.
    const now = new Date();
    const basketBuckets = new Map();
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      basketBuckets.set(key, {
        key,
        label: formatMonthLabel(key),
        sum: 0,
        count: 0,
      });
    }
    for (const v of vols) {
      if (typeof v.price !== "number" || v.price <= 0) continue;
      const stamp = v.modified_on ?? v.created_on;
      if (!stamp) continue;
      const k = monthKey(stamp);
      const bucket = basketBuckets.get(k);
      if (!bucket) continue;
      bucket.sum += v.price;
      bucket.count += 1;
    }
    const basketEvolution = Array.from(basketBuckets.values()).map((b) => ({
      key: b.key,
      label: b.label,
      avg: b.count > 0 ? b.sum / b.count : 0,
      count: b.count,
    }));

    // ─── 7 — best quarter (most owned-volume / read events ever) ─
    // Combines two signals: a volume's `modified_on` (proxy for
    // when it joined the collection) and `read_at` (when it was
    // ticked off). Each volume can contribute up to 2 events to
    // its respective quarters.
    const quarterAgg = new Map();
    const tally = (stamp) => {
      const k = quarterKey(stamp);
      if (!k) return;
      quarterAgg.set(k, (quarterAgg.get(k) ?? 0) + 1);
    };
    for (const v of vols) {
      if (v.modified_on) tally(v.modified_on);
      if (v.read_at) tally(v.read_at);
    }
    let bestQuarter = null;
    for (const [key, count] of quarterAgg) {
      if (!bestQuarter || count > bestQuarter.count) {
        bestQuarter = { key, count, label: quarterLabel(key, lang) };
      }
    }

    // ─── 8 — anniversary / archivist tenure ──────────────────────
    let firstSeries = null;
    let firstTs = Infinity;
    for (const m of lib) {
      const ts = m.created_on ? new Date(m.created_on).getTime() : NaN;
      if (Number.isFinite(ts) && ts < firstTs) {
        firstTs = ts;
        firstSeries = m;
      }
    }
    const anniversary = firstSeries
      ? {
          firstSeriesName: firstSeries.name,
          firstSeriesMalId: firstSeries.mal_id,
          firstSeriesPoster: firstSeries.image_url_jpg ?? null,
          firstSeriesAt: firstSeries.created_on,
          days: Math.max(
            0,
            Math.floor((Date.now() - firstTs) / (1000 * 60 * 60 * 24)),
          ),
        }
      : null;

    return {
      authors,
      publishers,
      readingDelay,
      dokuhaRatio,
      topVolumePrices,
      basketEvolution,
      bestQuarter,
      anniversary,
    };
  }, [library, volumes, lang]);

  return { ...bundle, loading };
}
