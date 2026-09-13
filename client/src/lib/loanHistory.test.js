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

  /*
   * The ledger arrives in whatever order the server sent it, so the
   * newest-first ordering has to be asserted on rows that are not
   * already sorted — otherwise the sort could be deleted outright and
   * nothing would notice.
   */
  it("orders the ledger by lend date, not by the order it arrived in", () => {
    const shuffled = [
      { borrower: "Oldest", loaned_at: "2024-01-01T00:00:00Z" },
      { borrower: "Newest", loaned_at: "2026-06-01T00:00:00Z" },
      { borrower: "Middle", loaned_at: "2025-06-01T00:00:00Z" },
    ];
    expect(knownBorrowers(shuffled)).toEqual(["Newest", "Middle", "Oldest"]);
  });

  it("skips rows and names that are not there", () => {
    const holes = [
      { borrower: "Alex", loaned_at: "2026-01-01T00:00:00Z" },
      null,
      { borrower: null, loaned_at: "2026-02-01T00:00:00Z" },
      { borrower: "   ", loaned_at: "2026-03-01T00:00:00Z" },
      { loaned_at: "2026-04-01T00:00:00Z" },
    ];
    expect(knownBorrowers(holes, [null, { loaned_to: undefined }])).toEqual([
      "Alex",
    ]);
  });

  it("copes with nothing", () => {
    expect(knownBorrowers(undefined)).toEqual([]);
    expect(knownBorrowers([], "not a list")).toEqual([]);
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

  it("tells the tome still out from the ones already back", () => {
    const rows = [
      {
        mal_id: 7,
        vol_num: 3,
        loaned_at: "2026-01-01T00:00:00Z",
        returned_at: "2026-01-10T00:00:00Z",
      },
      {
        mal_id: 7,
        vol_num: 3,
        loaned_at: "2026-02-01T00:00:00Z",
        returned_at: null,
      },
      {
        mal_id: 7,
        vol_num: 3,
        loaned_at: "2026-03-01T00:00:00Z",
        returned_at: "2026-03-05T00:00:00Z",
      },
    ];
    expect(historyForVolume(rows, 7, 3)).toEqual({
      count: 3,
      open: 1,
      lastReturnedAt: "2026-03-05T00:00:00.000Z",
    });
  });

  it("says nothing came back when nothing came back", () => {
    const rows = [
      {
        mal_id: 7,
        vol_num: 3,
        loaned_at: "2026-02-01T00:00:00Z",
        returned_at: null,
      },
    ];
    expect(historyForVolume(rows, 7, 3)).toEqual({
      count: 1,
      open: 1,
      lastReturnedAt: null,
    });
  });

  it("matches on both the series and the tome, and ignores holes", () => {
    expect(historyForVolume([...history, null], 13, 9)).toEqual({
      count: 0,
      open: 0,
      lastReturnedAt: null,
    });
    expect(historyForVolume(history, 99, 1).count).toBe(0);
    expect(historyForVolume(undefined, 13, 1).count).toBe(0);
  });
});
