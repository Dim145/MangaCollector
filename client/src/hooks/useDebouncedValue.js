import { useEffect, useState } from "react";

/*
 * 待 · Debounced echo of a fast-changing value.
 *
 * Returns a snapshot of `value` that only updates after `delayMs`
 * has elapsed without any further changes. Lets a UI keep an
 * input feeling instant (controlled component re-renders per
 * keystroke) while the heavier downstream work (network query,
 * URL parsing, expensive filter) runs against the deferred value.
 *
 * Audit at the time of writing:
 *   - Dashboard / CalendarPage / CommandPalette / AvatarPicker run
 *     in-memory filters and are already sub-ms per keystroke; adding
 *     a debounce would only delay the visual update, hurting UX.
 *   - AddPage triggers its MAL/MangaDex search on explicit submit —
 *     debounce-by-input doesn't apply.
 *
 * The hook is shipped now as reusable infrastructure for upcoming
 * features (Tier 7: quick-add paste detection, smart filter previews)
 * where a deferred read of a typed value is genuinely useful.
 */
export function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
