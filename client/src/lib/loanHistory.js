/**
 * 預け · Read-side helpers over the loan ledger (`GET /volume/loans/history`).
 */

/** Borrower names, most recently seen first, deduplicated case-insensitively. */
export function knownBorrowers(history, currentLoans = []) {
  const seen = new Set();
  const out = [];
  const push = (name) => {
    const clean = String(name ?? "").trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  for (const l of Array.isArray(currentLoans) ? currentLoans : [])
    push(l?.loaned_to);
  // The rest of this function guards every row with `?.` because the
  // cached ledger can hold a hole; the comparator did not, and threw on
  // the first `null` as soon as there were two rows to compare.
  const lentAt = (row) => new Date(row?.loaned_at ?? 0).getTime() || 0;
  const rows = (Array.isArray(history) ? [...history] : []).sort(
    (a, b) => lentAt(b) - lentAt(a),
  );
  for (const h of rows) push(h?.borrower);
  return out;
}

/** What one tome's ledger says: how often it went out, when it last came back. */
export function historyForVolume(history, malId, volNum) {
  const rows = (Array.isArray(history) ? history : []).filter(
    (h) => h?.mal_id === malId && h?.vol_num === volNum,
  );
  const open = rows.filter((h) => !h.returned_at).length;
  const returned = rows
    .filter((h) => h.returned_at)
    .map((h) => new Date(h.returned_at).getTime())
    .filter(Number.isFinite);
  return {
    count: rows.length,
    open,
    lastReturnedAt: returned.length
      ? new Date(Math.max(...returned)).toISOString()
      : null,
  };
}
