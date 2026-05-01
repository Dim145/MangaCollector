import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { cacheStreak, db, STREAK_KEY } from "@/lib/db.js";

/*
 * 連 · Activity streak — pulled from the server's compute_streak
 * service which walks the activity_log and folds events into
 * distinct UTC days. See `services/activity.rs` for the rule set
 * (a one-day grace at midnight UTC keeps the streak intact between
 * the new-day boundary and the user's first activity of the day).
 *
 * Same dual-source contract as `useUserSettings` / `useSeals`:
 *   - Dexie `streak` table is the source of truth rendered in the
 *     UI. `useLiveQuery` reacts to writes so a successful refetch
 *     immediately updates the chip without a re-mount.
 *   - A background `useQuery` refreshes from the server, then
 *     mirrors the response into Dexie via `cacheStreak`.
 *
 * Offline contract:
 *   - Hard-reload while offline → `useLiveQuery` returns the last
 *     cached row and the chip renders with last-known-good numbers.
 *     `useQuery` fires anyway and silently fails — the toaster's
 *     non-essential-fetch convention applies (no surfaced error).
 *   - First-ever visit while offline → both Dexie row and network
 *     are empty → hook returns `null`, the chip self-hides.
 *
 * The server stays authoritative — local writes (e.g. marking a
 * volume owned offline) don't bump `current_streak` in real time.
 * The next online sync refreshes the cache. Acceptable for a
 * "soft motivator" chip; a real-time client-side recompute would
 * have to mirror the Rust algorithm and would drift on edge cases
 * (timezone boundaries, the midnight grace window).
 */
export function useStreak() {
  const cached = useLiveQuery(async () => {
    const row = await db.streak.get(STREAK_KEY);
    if (!row) return null;
    // eslint-disable-next-line no-unused-vars
    const { key, ...rest } = row;
    return rest;
  }, []);

  useQuery({
    queryKey: ["streak"],
    queryFn: async () => {
      const { data } = await axios.get(`/api/user/streak`);
      await cacheStreak(data);
      return data;
    },
    // 5 minutes — chip doesn't drift mid-session, route bounce
    // refetches naturally.
    staleTime: 5 * 60 * 1000,
  });

  return cached ?? null;
}
