import { describe, expect, it } from "vitest";
import { countOverdueLoans, countReleasesThisMonth } from "./navCounters.js";

const NOW = Date.UTC(2026, 8, 13, 12); // 13 Sep 2026, midday

describe("countOverdueLoans", () => {
  /*
   * Counts are deliberately asymmetric — two overdue among seven rows.
   * A test where the wanted answer happens to equal the answer an
   * inverted condition produces proves nothing, which is exactly what
   * the first version of this file did.
   */
  it("counts lent tomes past their return date, and nothing else", () => {
    const vols = [
      { loaned_to: "Alex", loan_due_at: "2026-09-01T00:00:00Z" }, // overdue
      { loaned_to: "Sam", loan_due_at: "2026-09-05T00:00:00Z" }, // overdue
      { loaned_to: "Léa", loan_due_at: "2026-09-30T00:00:00Z" }, // still in time
      { loaned_to: "Marco", loan_due_at: null }, // open-ended loan
      { loaned_to: null, loan_due_at: "2026-01-01T00:00:00Z" }, // not lent at all
      { loaned_to: "Yuki", loan_due_at: "not a date" }, // unparseable
      null, // a hole in the cached rows
    ];
    expect(countOverdueLoans(vols, NOW)).toBe(2);
  });

  it("leaves a loan due at this very instant alone", () => {
    const due = [
      { loaned_to: "Alex", loan_due_at: new Date(NOW).toISOString() },
    ];
    expect(countOverdueLoans(due, NOW)).toBe(0);
    expect(countOverdueLoans(due, NOW + 1)).toBe(1);
  });

  it("copes with anything that is not a list of rows", () => {
    expect(countOverdueLoans(undefined, NOW)).toBe(0);
    expect(countOverdueLoans(null, NOW)).toBe(0);
    expect(countOverdueLoans([], NOW)).toBe(0);
  });
});

describe("countReleasesThisMonth", () => {
  it("counts announced tomes still to come before the month ends", () => {
    const vols = [
      { release_date: "2026-09-20T00:00:00Z" }, // to come
      { release_date: "2026-09-25T00:00:00Z" }, // to come
      { release_date: "2026-09-10T00:00:00Z" }, // already out
      { release_date: "2026-10-02T00:00:00Z" }, // next month
      { release_date: "not a date" },
      { release_date: null },
      null,
    ];
    expect(countReleasesThisMonth(vols, NOW)).toBe(2);
  });

  it("excludes both ends of the window", () => {
    const on = (ms) => [{ release_date: new Date(ms).toISOString() }];
    const firstOfNextMonth = Date.UTC(2026, 9, 1);
    expect(countReleasesThisMonth(on(NOW), NOW)).toBe(0);
    expect(countReleasesThisMonth(on(NOW + 1), NOW)).toBe(1);
    expect(countReleasesThisMonth(on(firstOfNextMonth), NOW)).toBe(0);
    expect(countReleasesThisMonth(on(firstOfNextMonth - 1), NOW)).toBe(1);
  });

  it("rolls over the year in December", () => {
    const inDecember = Date.UTC(2026, 11, 15, 12);
    const vols = [
      { release_date: "2026-12-28T00:00:00Z" }, // this month
      { release_date: "2027-01-03T00:00:00Z" }, // next month, next year
    ];
    expect(countReleasesThisMonth(vols, inDecember)).toBe(1);
  });

  it("copes with anything that is not a list of rows", () => {
    expect(countReleasesThisMonth(undefined, NOW)).toBe(0);
    expect(countReleasesThisMonth([], NOW)).toBe(0);
  });
});
