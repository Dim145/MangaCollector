import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db.js";

/**
 * Distinct list of publishers / éditeurs the user has ever attached to a
 * library row — pulled from every entry in the Dexie `library` cache.
 * Frequency-sorted (most used first) so the suggestion datalist surfaces
 * the user's go-to imprints at the top of the dropdown.
 *
 * Same shape and semantics as `useKnownStores`:
 *   - Case-folded dedupe ("Glénat" / "glénat" / "GLÉNAT" → one entry)
 *   - Display form preserves the casing of the FIRST occurrence
 *   - Empty / nullish values skipped
 *
 * The hook returns ONLY user-typed publishers; the caller is responsible
 * for merging with the static `PUBLISHER_PRESETS` list before feeding the
 * datalist. This keeps the boundary clean: the hook's output is "what the
 * user has personally seen", the presets are "what we think is common
 * across markets".
 */
export function useKnownPublishers() {
  const library = useLiveQuery(() => db.library.toArray(), []);

  return useMemo(() => {
    const counts = new Map();
    const displays = new Map();

    for (const row of library ?? []) {
      const trimmed = (row?.publisher ?? "").trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!displays.has(key)) displays.set(key, trimmed);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => displays.get(key));
  }, [library]);
}
