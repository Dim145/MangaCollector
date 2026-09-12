import { describe, expect, it } from "vitest";
import { laneCountForWidth, rowsForItems } from "./useWindowGridVirtualizer.js";

const LANES = [
  { min: 1024, lanes: 3 },
  { min: 640, lanes: 2 },
  { min: 0, lanes: 1 },
];

describe("laneCountForWidth", () => {
  it.each([
    [320, 1],
    [639, 1],
    [640, 2],
    [1023, 2],
    [1024, 3],
    [2560, 3],
  ])("maps a %ipx viewport to %i lanes", (w, lanes) => {
    expect(laneCountForWidth(w, LANES)).toBe(lanes);
  });

  it("falls back to the narrowest breakpoint for an impossible width", () => {
    expect(laneCountForWidth(-1, LANES)).toBe(1);
  });
});

describe("rowsForItems", () => {
  it("returns no rows when nothing is pinned", () => {
    expect(rowsForItems(undefined, 3, 10)).toEqual([]);
    expect(rowsForItems([], 3, 10)).toEqual([]);
  });

  it("maps item indexes to their row for the given lane count", () => {
    // 3 lanes: items 0-2 → row 0, 3-5 → row 1, …
    expect(rowsForItems([4], 3, 10)).toEqual([1]);
    expect(rowsForItems([0, 2], 3, 10)).toEqual([0]);
    expect(rowsForItems([9], 3, 10)).toEqual([3]);
  });

  it("dedupes and sorts", () => {
    expect(rowsForItems([7, 1, 8, 0], 3, 10)).toEqual([0, 2]);
  });

  it("re-maps when the lane count changes", () => {
    // The same busy tile lands in a different row on a narrower screen.
    expect(rowsForItems([5], 3, 10)).toEqual([1]);
    expect(rowsForItems([5], 1, 10)).toEqual([5]);
  });

  it("drops rows beyond the grid and junk indexes", () => {
    expect(rowsForItems([30, -1, 2.5, NaN, 1], 3, 4)).toEqual([0]);
  });
});
