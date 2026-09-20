import { describe, expect, it } from "vitest";
import {
  gapSuggestions,
  seriesIsComplete,
  skippedCounts,
  wantedVolumes,
} from "./gaps.js";

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

describe("counting what the reader actually wants", () => {
  /*
   * 飛 · A run of twelve with two skipped is a run of ten. Owning the
   * ten is finished — not 83 %, which is what the shelf showed before
   * and what kept a deliberately partial collection permanently
   * unfinished.
   */
  it("counts the skipped tomes per series", () => {
    const counts = skippedCounts([
      { mal_id: 1, vol_num: 3, wanted: false },
      { mal_id: 1, vol_num: 7, wanted: false },
      { mal_id: 1, vol_num: 1, wanted: true },
      { mal_id: 2, vol_num: 2, wanted: false },
      { mal_id: 3, vol_num: 1 }, // absent = wanted
    ]);
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.get(3)).toBeUndefined();
    expect(skippedCounts(null).size).toBe(0);
  });

  it("stops counting a skipped tome once it is on the shelf", () => {
    // The drawer hides the skip toggle on an owned tome, so a row
    // marked skipped and bought later keeps `wanted: false` for good.
    // Counting it would take it out of the target while
    // `volumes_owned` still counts it in — a twelve-tome run missing
    // its last volume would read as finished.
    const counts = skippedCounts([
      { mal_id: 1, vol_num: 5, wanted: false, owned: true },
      { mal_id: 2, vol_num: 5, wanted: false, owned: false },
    ]);
    expect(counts.get(1)).toBeUndefined();
    expect(counts.get(2)).toBe(1);
    // Twelve published, eleven on the shelf (one of them the tome that
    // was skipped and bought since), the twelfth genuinely missing.
    const series = { volumes: 12, volumes_owned: 11 };
    expect(seriesIsComplete(series, counts.get(1) ?? 0)).toBe(false);
  });

  it("takes the skipped tomes out of the target", () => {
    expect(wantedVolumes({ volumes: 12 }, 2)).toBe(10);
    expect(wantedVolumes({ volumes: 12 })).toBe(12);
    // More skipped than published cannot go negative.
    expect(wantedVolumes({ volumes: 3 }, 9)).toBe(0);
    expect(wantedVolumes(null)).toBe(0);
  });

  it("calls a series complete once every wanted tome is in", () => {
    const series = { volumes: 12, volumes_owned: 10 };
    expect(seriesIsComplete(series, 2)).toBe(true);
    expect(seriesIsComplete(series, 1)).toBe(false);
    expect(seriesIsComplete(series, 0)).toBe(false);
    // A series with nothing published is not complete, skipped or not.
    expect(seriesIsComplete({ volumes: 0, volumes_owned: 0 }, 0)).toBe(false);
    // Nor is one whose every tome was skipped: there is nothing to own.
    expect(seriesIsComplete({ volumes: 3, volumes_owned: 0 }, 3)).toBe(false);
  });
});
