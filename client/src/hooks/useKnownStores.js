import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db.js";

/**
 * Distinct list of stores the user has ever typed — pulled from every owned
 * volume + every coffret in Dexie. Frequency-sorted (most used first) so the
 * suggestion dropdown surfaces the user's go-to retailers at the top.
 *
 * Case-folded deduplication keeps "amazon", "Amazon" and "AMAZON " from
 * showing up as three separate entries, but the display form preserves the
 * casing the user actually typed (first occurrence wins).
 */
export function useKnownStores() {
  const volumes = useLiveQuery(() => db.volumes.toArray(), []);

  return useMemo(() => {
    const counts = new Map();
    const displays = new Map();

    const pushOne = (raw) => {
      const trimmed = (raw ?? "").trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!displays.has(key)) displays.set(key, trimmed);
    };

    for (const v of volumes ?? []) {
      if (v.owned) pushOne(v.store);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => displays.get(key));
  }, [volumes]);
}
