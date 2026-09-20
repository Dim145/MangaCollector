import { useMemo } from "react";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { summarisePeriod } from "@/lib/wrapped.js";

/**
 * 収 · The wrapped for one period, from the rows already cached by
 * `useLibrary()` and `useAllVolumes()` — no extra round trip, and it
 * works offline.
 *
 * `month` is 0–11 for a single month, `null` (the default) for the
 * whole year. The aggregation itself lives in `lib/wrapped.js`, where
 * it can be tested without a React tree.
 */
export function useYearInReview(year, month = null) {
  const { data: library, isInitialLoad: libLoading } = useLibrary();
  const { data: volumes, isInitialLoad: volLoading } = useAllVolumes();

  const bundle = useMemo(
    () => summarisePeriod(library, volumes, { year, month }),
    [library, volumes, year, month],
  );

  return { bundle, loading: libLoading || volLoading };
}
