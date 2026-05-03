import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db.js";

/**
 * 山積 Yamazumi · Reading-pile audit.
 *
 * Aggregates owned-but-unread volumes from the local Dexie cache and
 * surfaces three metrics that matter for collectors carrying long
 * backlogs:
 *
 *   • TOTAL — N owned volumes that have `read_at = null`
 *   • PER-SERIES BREAKDOWN — for each series, how many vols are
 *     unread, the oldest acquisition date, and a "stale months"
 *     count (months since the user last read ANY vol of that
 *     series, computed from the max read_at across the series'
 *     volumes; null when no volume of that series has been read)
 *   • PACE — average days between read_at timestamps over the last
 *     90 days. Used by the consumer page to project a "time to
 *     clear" estimate.
 *
 * Pure derivation from already-cached data — no network. Re-runs
 * automatically when Dexie changes (live query).
 */
export function useBacklog() {
  const library = useLiveQuery(() => db.library.toArray(), []);
  const volumes = useLiveQuery(() => db.volumes.toArray(), []);

  return useMemo(() => {
    if (!library || !volumes) return null;

    // Index library by mal_id for O(1) lookup as we walk volumes.
    const libByMal = new Map();
    for (const m of library) libByMal.set(m.mal_id, m);

    // Per-series accumulator. We only create an entry when at least
    // one of its volumes is owned-and-unread; series the user has
    // fully consumed don't show up at all.
    const seriesAcc = new Map();
    let totalUnread = 0;
    const readDates = [];

    for (const v of volumes) {
      if (v.read_at) readDates.push(new Date(v.read_at).getTime());
      if (!v.owned) continue;
      if (v.read_at) continue;

      totalUnread += 1;

      const mal = v.mal_id;
      if (!seriesAcc.has(mal)) {
        seriesAcc.set(mal, {
          mal_id: mal,
          name: libByMal.get(mal)?.name ?? null,
          image_url_jpg: libByMal.get(mal)?.image_url_jpg ?? null,
          unreadCount: 0,
          oldestAcquired: null,
          lastReadAt: null,
        });
      }
      const acc = seriesAcc.get(mal);
      acc.unreadCount += 1;
      // `created_on` on the volume is when the user added the row —
      // proxy for "when this volume entered the pile". Series-level
      // `created_on` (when the series was added to the library) is a
      // poor signal for THIS particular volume's age once volumes are
      // added incrementally.
      const acquiredAt = v.created_on
        ? new Date(v.created_on).getTime()
        : null;
      if (acquiredAt && (!acc.oldestAcquired || acquiredAt < acc.oldestAcquired)) {
        acc.oldestAcquired = acquiredAt;
      }
    }

    // Second pass over volumes to compute lastReadAt per series — we
    // care about ANY read in the series, not just unread ones, so we
    // can't fold this into the loop above (those iterate only owned-
    // unread volumes). Cheaper than a third Map lookup since volumes
    // is already in memory.
    for (const v of volumes) {
      if (!v.read_at) continue;
      const acc = seriesAcc.get(v.mal_id);
      if (!acc) continue;
      const ts = new Date(v.read_at).getTime();
      if (!acc.lastReadAt || ts > acc.lastReadAt) acc.lastReadAt = ts;
    }

    // Reading pace: average days between consecutive reads in the
    // last 90 days. A user with 0 or 1 reads gets `null` (not enough
    // data), and the consumer renders "—" instead of a fake estimate.
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const recentReads = readDates
      .filter((t) => t >= cutoff)
      .sort((a, b) => a - b);
    let avgDaysBetweenReads = null;
    if (recentReads.length >= 2) {
      const span = recentReads[recentReads.length - 1] - recentReads[0];
      avgDaysBetweenReads =
        span / (recentReads.length - 1) / (24 * 60 * 60 * 1000);
    }

    // Project months-to-clear at the current pace. If pace is null
    // we surface null too — the page renders "—" rather than a NaN.
    let monthsToClear = null;
    if (avgDaysBetweenReads != null && avgDaysBetweenReads > 0) {
      const totalDays = totalUnread * avgDaysBetweenReads;
      monthsToClear = totalDays / 30;
    }

    // Per-series array sorted by "abandonment risk":
    //   primary: stale months (more = riskier)
    //   tiebreak: unread count (more = bigger pile)
    const now = Date.now();
    const monthsSince = (ts) =>
      ts == null ? null : (now - ts) / (1000 * 60 * 60 * 24 * 30);

    const seriesList = Array.from(seriesAcc.values())
      .map((acc) => ({
        ...acc,
        ageMonths: monthsSince(acc.oldestAcquired),
        staleMonths: monthsSince(acc.lastReadAt),
      }))
      .sort((a, b) => {
        // Series the user has NEVER read (staleMonths === null)
        // should sort below those with a real stale clock. Treating
        // null as Infinity would put never-touched series at the
        // top, which feels accusatory; we'd rather promote series
        // the user IS engaging with but has slowed on.
        const aRisk = a.staleMonths ?? -1;
        const bRisk = b.staleMonths ?? -1;
        if (aRisk !== bRisk) return bRisk - aRisk;
        return b.unreadCount - a.unreadCount;
      });

    return {
      totalUnread,
      seriesCount: seriesAcc.size,
      seriesList,
      avgDaysBetweenReads,
      monthsToClear,
    };
  }, [library, volumes]);
}
