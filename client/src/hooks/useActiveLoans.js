import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import axios from "@/utils/axios.js";
import { db } from "@/lib/db.js";

/**
 * 預け Azuke · Outstanding loans listing.
 *
 * Hybrid Dexie + React-Query so the dashboard rail stays useful
 * offline. Both columns the widget needs (loaned_to, loan_due_at,
 * series_name via library) already live in Dexie:
 *   - `db.volumes` has `loaned_to` / `loan_started_at` / `loan_due_at`
 *     for every volume the user owns (the optimistic outbox writes
 *     them on every lend / return / due-date edit).
 *   - `db.library` has `name` / `image_url_jpg` so we can attach the
 *     series identity to each lent volume.
 *
 * The server endpoint `/api/user/volume/loans` was the original
 * source — we keep firing it as a `useQuery` to refresh on focus
 * and reconcile cross-device edits, but render priority goes to
 * the Dexie scan so the widget mounts instantly AND survives a
 * server outage.
 *
 * Sort: overdue first, then by due date asc, then undated last —
 * mirrors the server's `services::volume::list_active_loans` order
 * so the offline shape matches the online shape exactly.
 */
export function useActiveLoans() {
  // Live data from Dexie. Filter shape mirrors the server's
  // `WHERE loaned_to IS NOT NULL` query, with a defensive guard on
  // `loan_started_at` (the server invariant: loaned_to ↔
  // loan_started_at) so a half-written row from a partial outbox
  // replay doesn't slip through with a NULL start.
  const cached = useLiveQuery(async () => {
    const lent = await db.volumes
      .filter((v) => Boolean(v.loaned_to) && Boolean(v.loan_started_at))
      .toArray();
    if (lent.length === 0) return [];

    // Build a single-pass library lookup so the join over N lent
    // volumes stays O(N + L) instead of O(N × L). Library is small
    // (typical user: 50-500 rows) so toArray() is fine here.
    const lib = await db.library.toArray();
    const lookup = new Map();
    for (const row of lib) {
      if (row.mal_id != null) {
        lookup.set(row.mal_id, {
          name: row.name ?? null,
          image: row.image_url_jpg ?? null,
        });
      }
    }

    const enriched = lent.map((v) => {
      const meta = v.mal_id != null ? lookup.get(v.mal_id) : null;
      return {
        volume_id: v.id,
        mal_id: v.mal_id,
        vol_num: v.vol_num,
        series_name: meta?.name ?? null,
        series_image_url: meta?.image ?? null,
        loaned_to: v.loaned_to,
        loan_started_at: v.loan_started_at,
        loan_due_at: v.loan_due_at ?? null,
      };
    });

    // Same sort as the server: overdue+due_soon first (sorted by
    // due asc), then undated last (sorted by start asc as
    // tiebreaker so the oldest open loan surfaces).
    return enriched.sort((a, b) => {
      const ad = a.loan_due_at;
      const bd = b.loan_due_at;
      if (ad && bd) return new Date(ad).getTime() - new Date(bd).getTime();
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return (
        new Date(a.loan_started_at).getTime() -
        new Date(b.loan_started_at).getTime()
      );
    });
  }, []);

  // Backgrounded server fetch — keeps the cache fresh on focus and
  // reconciles cross-device lends. Failures fold to "use the cache"
  // (the server is the only authority but the cache is the fallback).
  const query = useQuery({
    queryKey: ["loans", "active"],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await axios.get("/api/user/volume/loans");
      return Array.isArray(data) ? data : [];
    },
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status === 401 || status === 404) return false;
      return failureCount < 2;
    },
  });

  // Render priority: Dexie if it has answered, otherwise the
  // server response, otherwise empty. The widget self-hides on
  // empty so a brief loading flash isn't a concern.
  const data = cached ?? query.data ?? [];

  return {
    data,
    // Block the loader only while Dexie hasn't answered AND the
    // network query is still pending.
    isLoading: cached === undefined && query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}

/**
 * 預け · Loan classification helper. Returns one of:
 *   - "overdue" → due date has passed
 *   - "due_soon" → within 7 days of due date
 *   - "active" → has a future due date
 *   - "open" → no due date set
 *
 * The widget renders different chip colours per category so the user
 * can scan the list and act on overdue loans first.
 */
export function classifyLoan(loan, now = Date.now()) {
  if (!loan?.loan_due_at) return "open";
  const due = new Date(loan.loan_due_at).getTime();
  if (Number.isNaN(due)) return "open";
  if (due < now) return "overdue";
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (due - now < sevenDays) return "due_soon";
  return "active";
}
