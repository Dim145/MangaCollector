/**
 * 数 · The two pulses the navigation shows as badges, computed from the
 * cached volume rows so they work offline and cost no request.
 */

/** Loans whose return date is behind us. */
export function countOverdueLoans(volumes, now = Date.now()) {
  let n = 0;
  for (const v of Array.isArray(volumes) ? volumes : []) {
    if (!v?.loaned_to || !v.loan_due_at) continue;
    const due = new Date(v.loan_due_at).getTime();
    if (Number.isFinite(due) && due < now) n += 1;
  }
  return n;
}

/** Announced tomes still to come out before this month ends. */
export function countReleasesThisMonth(volumes, now = Date.now()) {
  const start = new Date(now);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime();
  let n = 0;
  for (const v of Array.isArray(volumes) ? volumes : []) {
    if (!v?.release_date) continue;
    const ts = new Date(v.release_date).getTime();
    if (Number.isFinite(ts) && ts > now && ts < end) n += 1;
  }
  return n;
}
