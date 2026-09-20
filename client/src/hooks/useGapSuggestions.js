import { useMemo } from "react";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { gapSuggestions } from "@/lib/gaps.js";

/**
 * R1 — "Complete your collection" suggestions.
 *
 * Returns the specific missing volume numbers per series plus the gap
 * count, shortest-to-complete first (closer to the finish line = more
 * motivating). The rule itself lives in `lib/gaps.js`, where it can be
 * tested without React Query or Dexie — including the two exclusions
 * that matter: a discontinued edition, and volumes the reader chose to
 * skip.
 *
 * Everything is derived locally from Dexie — zero network calls.
 */
export function useGapSuggestions(limit = 4) {
  const { data: library } = useLibrary();
  const { data: volumes } = useAllVolumes();

  return useMemo(
    () => gapSuggestions(library, volumes, limit),
    [library, volumes, limit],
  );
}
