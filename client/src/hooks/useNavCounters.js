import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db.js";
import {
  countOverdueLoans,
  countReleasesThisMonth,
} from "@/lib/navCounters.js";

const DAY_MS = 86_400_000;

/**
 * 数 · Badges for the navigation, from the cached volumes: overdue loans
 * (the library, where the loans widget lives) and tomes coming out
 * before the month ends (the calendar). No request, works offline.
 *
 * 索 · Two indexed reads instead of the whole table. The header is on
 * every page, and it used to load every tome — a megabyte on the seeded
 * shelf — again after each write to any of them, to find a handful.
 * `loan_started_at` holds only the lent tomes, `release_date` only the
 * dated ones (`lib/db.js`, schema v18); the counting itself, with the
 * clock read at render, stays in `lib/navCounters.js`.
 */
export function useNavCounters(enabled = true) {
  const lent = useLiveQuery(
    () =>
      enabled
        ? db.volumes.where("loan_started_at").above("").toArray()
        : Promise.resolve([]),
    [enabled],
  );
  const dated = useLiveQuery(
    () =>
      enabled
        ? db.volumes
            .where("release_date")
            .above(new Date(Date.now() - DAY_MS).toISOString())
            .toArray()
        : Promise.resolve([]),
    [enabled],
  );
  return useMemo(
    () => ({
      library: countOverdueLoans(lent ?? []),
      calendar: countReleasesThisMonth(dated ?? []),
    }),
    [lent, dated],
  );
}
