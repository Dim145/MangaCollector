import { describe, expect, it } from "vitest";
import {
  MIN_VOLUMES_MONTH,
  MIN_VOLUMES_YEAR,
  normalizeMonth,
  previousMonth,
  summarisePeriod,
} from "./wrapped.js";

// The suite runs with TZ=UTC (src/test/setup.js), so a `…Z` stamp keeps
// the month it reads.
const vol = (id, malId, iso, extra = {}) => ({
  id,
  mal_id: malId,
  vol_num: id,
  owned: true,
  price: 0,
  modified_on: iso,
  ...extra,
});

const LIB = [
  { mal_id: 1, name: "Vagabond", volumes: 3, volumes_owned: 3, genres: "Seinen,Historical" },
  { mal_id: 2, name: "Yotsuba", volumes: 10, volumes_owned: 2, genres: ["Slice of life"] },
];

describe("normalizeMonth", () => {
  it("takes 0–11 and reads anything else as the whole year", () => {
    expect(normalizeMonth(0)).toBe(0);
    expect(normalizeMonth(11)).toBe(11);
    expect(normalizeMonth(12)).toBeNull();
    expect(normalizeMonth(-1)).toBeNull();
    expect(normalizeMonth("september")).toBeNull();
    expect(normalizeMonth(3.5)).toBeNull();
    // The ones that coerce to 0 and would otherwise become January.
    expect(normalizeMonth(null)).toBeNull();
    expect(normalizeMonth(undefined)).toBeNull();
    expect(normalizeMonth(false)).toBeNull();
    expect(normalizeMonth("")).toBeNull();
  });
});

describe("previousMonth", () => {
  it("wraps January back to the December before it", () => {
    expect(previousMonth(2026, 0)).toEqual({ year: 2025, month: 11 });
    expect(previousMonth(2026, 9)).toEqual({ year: 2026, month: 8 });
  });
});

describe("summarisePeriod over a year", () => {
  const volumes = [
    vol(1, 1, "2026-03-05T10:00:00Z", { price: 8 }),
    vol(2, 1, "2026-03-20T10:00:00Z", { price: 8 }),
    vol(3, 1, "2026-09-02T10:00:00Z", { price: 9, read_at: "2026-09-04T10:00:00Z" }),
    vol(4, 2, "2026-09-11T10:00:00Z", { price: 7 }),
    vol(5, 2, "2026-09-25T10:00:00Z", { price: 7 }),
    // Another year entirely, and one the reader does not own.
    vol(6, 2, "2025-09-25T10:00:00Z"),
    vol(7, 1, "2026-09-26T10:00:00Z", { owned: false }),
  ];

  it("counts what was acquired and read inside the year", () => {
    const s = summarisePeriod(LIB, volumes, { year: 2026 });
    expect(s.volumesAcquired).toBe(5);
    expect(s.volumesRead).toBe(1);
    expect(s.totalSpent).toBe(39);
    expect(s.empty).toBe(false);
  });

  it("names the busiest month and has no previous-month figure", () => {
    const s = summarisePeriod(LIB, volumes, { year: 2026 });
    expect(s.bestMonth).toEqual({ index: 8, count: 3 });
    expect(s.previous).toBeNull();
    expect(s.accentSeason).toBe("autumn");
  });

  it("starts a series on its first-ever tome, not its first this year", () => {
    // Yotsuba's earliest owned tome is in 2025, so 2026 did not start it.
    const s = summarisePeriod(LIB, volumes, { year: 2026 });
    expect(s.seriesStarted).toBe(1);
    expect(summarisePeriod(LIB, volumes, { year: 2025 }).seriesStarted).toBe(1);
  });

  it("only completes a series that is complete today", () => {
    const s = summarisePeriod(LIB, volumes, { year: 2026 });
    // Vagabond is 3/3 and its last tome landed in 2026; Yotsuba is 2/10.
    expect(s.seriesCompleted).toBe(1);
  });

  it("reads genres from a comma string and from a list", () => {
    const s = summarisePeriod(LIB, volumes, { year: 2026 });
    expect(s.topGenres.map((g) => g.name)).toEqual([
      "Historical",
      "Seinen",
      "Slice of life",
    ]);
    expect(s.topGenres[0]).toMatchObject({ count: 3, share: 3 / 5 });
  });

  it("puts the bookends in the order they arrived", () => {
    const s = summarisePeriod(LIB, volumes, { year: 2026 });
    expect(s.firstVolume).toMatchObject({ vol_num: 1, seriesName: "Vagabond" });
    expect(s.lastVolume).toMatchObject({ vol_num: 5, seriesName: "Yotsuba" });
  });

  it("stays silent under its floor", () => {
    const few = volumes.slice(0, MIN_VOLUMES_YEAR - 1);
    expect(summarisePeriod(LIB, few, { year: 2026 }).empty).toBe(true);
  });
});

describe("summarisePeriod over one month", () => {
  const volumes = [
    vol(1, 1, "2026-08-04T10:00:00Z"),
    vol(2, 1, "2026-08-19T10:00:00Z"),
    vol(3, 1, "2026-09-02T10:00:00Z", { price: 9 }),
    vol(4, 2, "2026-09-11T10:00:00Z", { price: 7, read_at: "2026-09-12T10:00:00Z" }),
    vol(5, 2, "2026-09-25T10:00:00Z", { price: 7, read_at: "2026-10-02T10:00:00Z" }),
  ];

  it("keeps only that month, and reads the month it was read in", () => {
    const s = summarisePeriod(LIB, volumes, { year: 2026, month: 8 });
    expect(s.volumesAcquired).toBe(3);
    expect(s.totalSpent).toBe(23);
    // One of the two reads happened in October and does not count here.
    expect(s.volumesRead).toBe(1);
  });

  it("compares against the month before, fall included", () => {
    const s = summarisePeriod(LIB, volumes, { year: 2026, month: 8 });
    expect(s.previous).toEqual({ year: 2026, month: 7, count: 2, delta: 1 });
    const august = summarisePeriod(LIB, volumes, { year: 2026, month: 7 });
    // July holds nothing, so August is up two on nothing at all.
    expect(august.previous).toEqual({
      year: 2026,
      month: 6,
      count: 0,
      delta: 2,
    });
  });

  it("drops the busiest-month figure, which says nothing inside a month", () => {
    const s = summarisePeriod(LIB, volumes, { year: 2026, month: 8 });
    expect(s.bestMonth).toBeNull();
    expect(s.accentSeason).toBe("autumn");
  });

  it("asks for fewer tomes than a year before it says anything", () => {
    expect(MIN_VOLUMES_MONTH).toBeLessThan(MIN_VOLUMES_YEAR);
    const s = summarisePeriod(LIB, volumes, { year: 2026, month: 8 });
    expect(s.empty).toBe(false);
    // August has two, which is under the monthly floor.
    expect(summarisePeriod(LIB, volumes, { year: 2026, month: 7 }).empty).toBe(
      true,
    );
  });

  it("survives rows with no usable date and an empty library", () => {
    const junk = [
      vol(9, 1, null),
      vol(10, 1, "not a date"),
      { id: 11, mal_id: 1, owned: true },
    ];
    const s = summarisePeriod(null, junk, { year: 2026, month: 8 });
    expect(s.volumesAcquired).toBe(0);
    expect(s.topSeries).toBeNull();
    expect(s.firstVolume).toBeNull();
    expect(s.empty).toBe(true);
  });
});
