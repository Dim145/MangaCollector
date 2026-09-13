import { describe, expect, it } from "vitest";
import { historyForVolume, knownBorrowers } from "./loanHistory.js";

const history = [
  {
    mal_id: 13,
    vol_num: 1,
    borrower: "Alex",
    loaned_at: "2026-01-05T00:00:00Z",
    returned_at: "2026-01-20T00:00:00Z",
  },
  {
    mal_id: 13,
    vol_num: 1,
    borrower: "sam",
    loaned_at: "2026-03-01T00:00:00Z",
    returned_at: null,
  },
  {
    mal_id: 13,
    vol_num: 2,
    borrower: "Alex",
    loaned_at: "2026-02-01T00:00:00Z",
    returned_at: "2026-02-10T00:00:00Z",
  },
  {
    mal_id: 2,
    vol_num: 1,
    borrower: "  Léa ",
    loaned_at: "2025-12-01T00:00:00Z",
    returned_at: "2025-12-24T00:00:00Z",
  },
];

describe("knownBorrowers", () => {
  it("lists current borrowers first, then the ledger newest first, without duplicates", () => {
    expect(
      knownBorrowers(history, [{ loaned_to: "Marco" }, { loaned_to: "alex" }]),
    ).toEqual(["Marco", "alex", "sam", "Léa"]);
  });

  it("copes with nothing", () => {
    expect(knownBorrowers(undefined)).toEqual([]);
    expect(knownBorrowers([{ borrower: "   " }])).toEqual([]);
  });
});

describe("historyForVolume", () => {
  it("counts loans of one tome and remembers the last return", () => {
    expect(historyForVolume(history, 13, 1)).toEqual({
      count: 2,
      open: 1,
      lastReturnedAt: "2026-01-20T00:00:00.000Z",
    });
  });

  it("is empty for a tome never lent", () => {
    expect(historyForVolume(history, 13, 9)).toEqual({
      count: 0,
      open: 0,
      lastReturnedAt: null,
    });
  });
});
