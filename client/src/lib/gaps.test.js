import { describe, expect, it } from "vitest";
import { gapSuggestions } from "./gaps.js";

/*
 * 補 · What the dashboard offers to complete. Two exclusions carry the
 * weight, and both exist so the app never asks for something the
 * reader cannot do:
 *   - a discontinued edition, whose volume count still comes from
 *     MyAnimeList and therefore counts books nobody will print;
 *   - a volume the reader deliberately skipped.
 */

const series = (over = {}) => ({
  mal_id: 1,
  name: "Test",
  volumes: 5,
  volumes_owned: 2,
  ...over,
});
const owned = (mal_id, nums) =>
  nums.map((n) => ({ mal_id, vol_num: n, owned: true }));

describe("gapSuggestions", () => {
  it("lists the volumes that are missing, shortest gap first", () => {
    const library = [
      series({ mal_id: 1, volumes: 5 }),
      series({ mal_id: 2, volumes: 3 }),
    ];
    const volumes = [...owned(1, [1, 2]), ...owned(2, [1, 2])];
    const out = gapSuggestions(library, volumes);
    expect(out.map((s) => s.manga.mal_id)).toEqual([2, 1]);
    expect(out[0].missing).toEqual([3]);
    expect(out[1].missing).toEqual([3, 4, 5]);
  });

  it("leaves out a series that is already complete", () => {
    expect(gapSuggestions([series({ volumes: 2 })], owned(1, [1, 2]))).toEqual(
      [],
    );
  });

  it("leaves out a discontinued edition", () => {
    // Its count comes from MyAnimeList, which counts the Japanese
    // original: three "missing" volumes that were never published here.
    const library = [series({ publication_status: "stopped" })];
    expect(gapSuggestions(library, owned(1, [1, 2]))).toEqual([]);
  });

  it("keeps a concluded or paused edition — those gaps are fillable", () => {
    for (const status of ["completed", "paused", "ongoing", null, undefined]) {
      const out = gapSuggestions(
        [series({ publication_status: status })],
        owned(1, [1, 2]),
      );
      expect(out).toHaveLength(1);
      expect(out[0].missing).toEqual([3, 4, 5]);
    }
  });

  it("does not count a volume the reader chose to skip", () => {
    const volumes = [
      ...owned(1, [1, 2]),
      { mal_id: 1, vol_num: 3, owned: false, wanted: false },
    ];
    const out = gapSuggestions([series()], volumes);
    expect(out[0].missing).toEqual([4, 5]);
    expect(out[0].gap).toBe(2);
  });

  it("treats a series whose every remaining volume is skipped as done", () => {
    const volumes = [
      ...owned(1, [1, 2]),
      ...[3, 4, 5].map((n) => ({
        mal_id: 1,
        vol_num: n,
        owned: false,
        wanted: false,
      })),
    ];
    expect(gapSuggestions([series()], volumes)).toEqual([]);
  });

  it("survives empty and unknown input", () => {
    expect(gapSuggestions([], [])).toEqual([]);
    expect(gapSuggestions(null, null)).toEqual([]);
    expect(gapSuggestions([series({ volumes: 0 })], [])).toEqual([]);
  });
});
