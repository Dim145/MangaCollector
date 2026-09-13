import { describe, expect, it } from "vitest";
import { computeDoubles, computeLibraryStats } from "./libraryStats.js";

/*
 * `computeLibraryStats` is the single source of truth behind the
 * profile dashboard, the snapshot page and the author page. Its
 * contract is documented in the module header — these tests pin each
 * clause of it, with particular attention to the rounding and
 * tie-breaking rules that the three former copies disagreed on.
 */

const series = (over = {}) => ({
  volumes: 0,
  volumes_owned: 0,
  genres: [],
  ...over,
});

describe("computeLibraryStats", () => {
  it("returns a zeroed shape for an empty library", () => {
    expect(computeLibraryStats([])).toEqual({
      seriesCount: 0,
      totalVolumes: 0,
      totalOwned: 0,
      seriesComplete: 0,
      completionPct: 0,
      topGenres: [],
    });
  });

  it.each([[null], [undefined], ["not an array"], [42], [{}]])(
    "treats non-array input %p as an empty library",
    (input) => {
      expect(computeLibraryStats(input).seriesCount).toBe(0);
    },
  );

  it("sums volumes and owned counts across series", () => {
    const stats = computeLibraryStats([
      series({ volumes: 10, volumes_owned: 4 }),
      series({ volumes: 5, volumes_owned: 5 }),
    ]);
    expect(stats.seriesCount).toBe(2);
    expect(stats.totalVolumes).toBe(15);
    expect(stats.totalOwned).toBe(9);
  });

  it("counts a series as complete when owned meets or exceeds volumes", () => {
    const stats = computeLibraryStats([
      series({ volumes: 5, volumes_owned: 5 }), // exactly complete
      series({ volumes: 5, volumes_owned: 7 }), // over-owned (duplicates)
      series({ volumes: 5, volumes_owned: 4 }), // incomplete
    ]);
    expect(stats.seriesComplete).toBe(2);
  });

  it("does not count an ongoing series with unknown volume count as complete", () => {
    // `volumes: 0` means "MAL doesn't know yet" — owning 3 of an
    // unknown total is not completion, and the `v > 0` guard is what
    // keeps the profile page from claiming otherwise.
    const stats = computeLibraryStats([
      series({ volumes: 0, volumes_owned: 3 }),
    ]);
    expect(stats.seriesComplete).toBe(0);
  });

  it("rounds the completion percentage to the nearest integer", () => {
    // 1/3 → 33.33… → 33
    expect(
      computeLibraryStats([series({ volumes: 3, volumes_owned: 1 })])
        .completionPct,
    ).toBe(33);
    // 2/3 → 66.66… → 67
    expect(
      computeLibraryStats([series({ volumes: 3, volumes_owned: 2 })])
        .completionPct,
    ).toBe(67);
  });

  it("reports 0% rather than NaN when no series has a volume count", () => {
    const stats = computeLibraryStats([
      series({ volumes: 0, volumes_owned: 0 }),
    ]);
    expect(stats.completionPct).toBe(0);
    expect(Number.isNaN(stats.completionPct)).toBe(false);
  });

  it("tolerates missing fields and null rows", () => {
    const stats = computeLibraryStats([{}, null, undefined, { volumes: 2 }]);
    expect(stats.seriesCount).toBe(4);
    expect(stats.totalVolumes).toBe(2);
    expect(stats.totalOwned).toBe(0);
  });

  describe("topGenres", () => {
    it("counts genres once per series, not per volume", () => {
      const stats = computeLibraryStats([
        series({ volumes: 100, volumes_owned: 100, genres: ["Action"] }),
        series({ volumes: 1, volumes_owned: 1, genres: ["Action"] }),
      ]);
      // Weighted by volumes this would be 101; series-level it is 2.
      expect(stats.topGenres).toEqual([{ name: "Action", count: 2 }]);
    });

    it("sorts by descending count", () => {
      const stats = computeLibraryStats([
        series({ genres: ["Action", "Drama"] }),
        series({ genres: ["Action"] }),
        series({ genres: ["Action", "Drama"] }),
      ]);
      expect(stats.topGenres).toEqual([
        { name: "Action", count: 3 },
        { name: "Drama", count: 2 },
      ]);
    });

    it("breaks count ties alphabetically so the order is stable", () => {
      const stats = computeLibraryStats([
        series({ genres: ["Seinen", "Action", "Mystery"] }),
      ]);
      expect(stats.topGenres.map((g) => g.name)).toEqual([
        "Action",
        "Mystery",
        "Seinen",
      ]);
    });

    it("caps the list at the default limit of 6", () => {
      const genres = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const stats = computeLibraryStats([series({ genres })]);
      expect(stats.topGenres).toHaveLength(6);
    });

    it("honours an explicit topGenresLimit", () => {
      const genres = ["a", "b", "c", "d", "e", "f", "g", "h"];
      expect(
        computeLibraryStats([series({ genres })], { topGenresLimit: 3 }),
      ).toHaveProperty("topGenres.length", 3);
    });

    it("trims whitespace and drops empty genre names", () => {
      const stats = computeLibraryStats([
        series({ genres: ["  Action  ", "", "   ", "Action"] }),
      ]);
      expect(stats.topGenres).toEqual([{ name: "Action", count: 2 }]);
    });

    it("survives a series whose genres field is missing", () => {
      expect(() => computeLibraryStats([{ volumes: 1 }])).not.toThrow();
      expect(computeLibraryStats([{ volumes: 1 }]).topGenres).toEqual([]);
    });
  });
});

describe("computeDoubles", () => {
  const NOW = Date.UTC(2026, 8, 13);
  const vol = (over) => ({
    id: 1,
    mal_id: 13,
    owned: true,
    price: 7.5,
    extra_copies: 0,
    release_date: null,
    ...over,
  });

  it("returns zeros for nothing, junk and single copies", () => {
    const zero = {
      extraCopies: 0,
      tomes: 0,
      series: 0,
      value: 0,
      pricedTomes: 0,
    };
    expect(computeDoubles(undefined, NOW)).toEqual(zero);
    expect(computeDoubles("nope", NOW)).toEqual(zero);
    expect(
      computeDoubles([vol(), vol({ id: 2, extra_copies: "many" })], NOW),
    ).toEqual(zero);
  });

  it("sums extras, counts tomes and distinct series, prices the estimate", () => {
    const rows = [
      vol({ id: 1, extra_copies: 1 }),
      vol({ id: 2, extra_copies: 2, price: 10 }),
      vol({ id: 3, mal_id: 2, extra_copies: 1, price: null }),
    ];
    expect(computeDoubles(rows, NOW)).toEqual({
      extraCopies: 4,
      tomes: 3,
      series: 2,
      value: 27.5,
      pricedTomes: 2,
    });
  });

  it("ignores copies that are not on the shelf", () => {
    const rows = [
      vol({ id: 1, owned: false, extra_copies: 3 }),
      vol({
        id: 2,
        extra_copies: 2,
        release_date: new Date(NOW + 86400000).toISOString(),
      }),
      vol({ id: 3, extra_copies: -1 }),
      vol({
        id: 4,
        extra_copies: 1,
        release_date: new Date(NOW - 86400000).toISOString(),
      }),
    ];
    expect(computeDoubles(rows, NOW)).toMatchObject({
      extraCopies: 1,
      tomes: 1,
    });
  });
});
