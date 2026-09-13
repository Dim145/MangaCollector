import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db.js";
import {
  countOverdueLoans,
  countReleasesThisMonth,
} from "@/lib/navCounters.js";

/**
 * 数 · Badges for the navigation, from the cached volumes: overdue loans
 * (the library, where the loans widget lives) and tomes coming out
 * before the month ends (the calendar). No request, works offline.
 */
export function useNavCounters(enabled = true) {
  const volumes = useLiveQuery(
    () => (enabled ? db.volumes.toArray() : Promise.resolve([])),
    [enabled],
  );
  return useMemo(
    () => ({
      library: countOverdueLoans(volumes ?? []),
      calendar: countReleasesThisMonth(volumes ?? []),
    }),
    [volumes],
  );
}
