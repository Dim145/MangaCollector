import { describe, expect, it } from "vitest";
import { countOverdueLoans, countReleasesThisMonth } from "./navCounters.js";

const NOW = Date.UTC(2026, 8, 13, 12); // 13 Sep 2026

describe("countOverdueLoans", () => {
  it("counts lent tomes past their return date only", () => {
    const vols = [
      { loaned_to: "Alex", loan_due_at: "2026-09-01T00:00:00Z" },
      { loaned_to: "Sam", loan_due_at: "2026-09-30T00:00:00Z" },
      { loaned_to: "Léa", loan_due_at: null },
      { loaned_to: null, loan_due_at: "2026-01-01T00:00:00Z" },
    ];
    expect(countOverdueLoans(vols, NOW)).toBe(1);
    expect(countOverdueLoans(undefined, NOW)).toBe(0);
  });
});

describe("countReleasesThisMonth", () => {
  it("counts announced tomes still to come before the month ends", () => {
    const vols = [
      { release_date: "2026-09-20T00:00:00Z" },
      { release_date: "2026-09-10T00:00:00Z" },
      { release_date: "2026-10-02T00:00:00Z" },
      { release_date: null },
    ];
    expect(countReleasesThisMonth(vols, NOW)).toBe(1);
  });
});
