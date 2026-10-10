import { describe, expect, it } from "vitest";
import {
  foldForSearch,
  highestVolumeBySeries,
  seriesForUpcoming,
} from "./upcomingPicker.js";

const library = [
  { mal_id: 13, name: "One Piece", volumes: 110 },
  { mal_id: 2, name: "Berserk", volumes: 42 },
  { mal_id: -7, name: "Ōkami no Kuni", volumes: 3 }, // a custom series
  { mal_id: 21, name: "akira", volumes: 6 },
];
const volumes = [
  { mal_id: 13, vol_num: 108 },
  { mal_id: 13, vol_num: 111 }, // an upcoming row beyond the count
  { mal_id: 2, vol_num: 41 },
  { mal_id: -7, vol_num: 3 },
];

describe("upcomingPicker", () => {
  it("proposes the volume after the highest one known", () => {
    const rows = seriesForUpcoming(library, volumes);
    const next = Object.fromEntries(rows.map((r) => [r.manga.mal_id, r.next]));
    // The rows win over the series' count: 111 is already noted.
    expect(next[13]).toBe(112);
    expect(next[2]).toBe(42);
    expect(next[-7]).toBe(4);
    // No volume row at all: the announced count is the floor.
    expect(next[21]).toBe(7);
  });

  it("lists the series by name, whatever their case", () => {
    const names = seriesForUpcoming(library, volumes).map((r) => r.manga.name);
    expect(names).toEqual(["akira", "Berserk", "Ōkami no Kuni", "One Piece"]);
  });

  it("finds a series without its accents or case", () => {
    const names = seriesForUpcoming(library, volumes, "okami").map((r) => r.manga.name);
    expect(names).toEqual(["Ōkami no Kuni"]);
    expect(seriesForUpcoming(library, volumes, "  PIECE ")).toHaveLength(1);
    expect(seriesForUpcoming(library, volumes, "nothing like it")).toEqual([]);
  });

  it("skips what cannot take a volume", () => {
    const rows = seriesForUpcoming(
      [{ mal_id: null, name: "No id" }, { mal_id: 5, name: "" }, ...library],
      [],
    );
    expect(rows).toHaveLength(library.length);
    expect(seriesForUpcoming(undefined, undefined)).toEqual([]);
  });

  it("folds accents and keeps the rest", () => {
    expect(foldForSearch("  Shōnen Été ")).toBe("shonen ete");
    expect(foldForSearch(null)).toBe("");
  });

  it("reads the highest number per series and ignores broken rows", () => {
    const highest = highestVolumeBySeries([
      ...volumes,
      { mal_id: 2, vol_num: null },
      { vol_num: 99 },
    ]);
    expect(highest.get(13)).toBe(111);
    expect(highest.get(2)).toBe(41);
    expect(highest.has(undefined)).toBe(false);
  });
});
