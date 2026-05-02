import { useQuery } from "@tanstack/react-query";
import axios from "@/utils/axios.js";

/**
 * 預け Azuke · Outstanding loans listing.
 *
 * Lazy-fetched against `GET /api/user/volume/loans`. The server joins
 * each volume with its parent series name + cover URL so the
 * dashboard widget can render rich loan rows in one round-trip. Loans
 * arrive sorted: overdue first, then by due date asc, undated last.
 *
 * Empty array (200) when nothing is currently lent — the widget
 * collapses to a quiet rest state. 1-minute staleTime keeps the
 * dashboard nimble across tab switches without hammering the API.
 */
export function useActiveLoans() {
  return useQuery({
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
