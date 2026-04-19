import { useMemo } from "react";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";

/**
 * R1 — "Complete your collection" suggestions.
 *
 * For each series where `volumes_owned < volumes`, return the specific
 * missing volume numbers plus the gap count. Sorted ascending so the
 * shortest-to-complete series come first (closer to the finish line =
 * more motivating).
 *
 * Everything is derived locally from Dexie — zero network calls.
 */
export function useGapSuggestions(limit = 4) {
  const { data: library } = useLibrary();
  const { data: volumes } = useAllVolumes();

  return useMemo(() => {
    if (!library?.length) return [];

    // Pre-index owned vol_num per mal_id for O(1) lookup
    const ownedByMal = new Map();
    for (const v of volumes) {
      if (!v.owned) continue;
      if (!ownedByMal.has(v.mal_id)) ownedByMal.set(v.mal_id, new Set());
      ownedByMal.get(v.mal_id).add(v.vol_num);
    }

    const suggestions = [];
    for (const m of library) {
      const total = m.volumes ?? 0;
      const owned = m.volumes_owned ?? 0;
      if (total <= 0) continue;
      if (owned >= total) continue;

      const ownedSet = ownedByMal.get(m.mal_id) ?? new Set();
      const missing = [];
      for (let i = 1; i <= total; i++) {
        if (!ownedSet.has(i)) missing.push(i);
      }
      // If the library knows a gap but the per-volume table hasn't synced
      // yet, fall back to trusting the counter.
      if (!missing.length) continue;

      suggestions.push({
        manga: m,
        missing,
        gap: total - owned,
      });
    }

    suggestions.sort((a, b) => a.gap - b.gap);
    return suggestions.slice(0, limit);
  }, [library, volumes, limit]);
}
