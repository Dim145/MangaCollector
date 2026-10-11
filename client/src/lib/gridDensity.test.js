import { describe, expect, it } from "vitest";
import {
  DEFAULT_DENSITY,
  DENSITIES,
  coverSizesFor,
  gapFor,
  gapsFromClassName,
  gridClassFor,
  isDensity,
  laneTable,
  lanesForWidth,
  lanesFromClassName,
} from "./gridDensity.js";

describe("gridDensity", () => {
  it("falls back to the comfortable shape for anything unknown", () => {
    expect(isDensity("dense")).toBe(true);
    expect(isDensity("cosy")).toBe(false);
    expect(laneTable("cosy")).toBe(laneTable(DEFAULT_DENSITY));
    expect(gridClassFor(null)).toBe(gridClassFor(DEFAULT_DENSITY));
  });

  it("keeps a stable table identity so the virtualizer only re-measures on a real change", () => {
    expect(laneTable("dense")).toBe(laneTable("dense"));
    expect(laneTable("dense")).not.toBe(laneTable("comfortable"));
  });

  it("shows more covers per row when dense, at every width", () => {
    for (const width of [320, 700, 900, 1100, 1400]) {
      expect(lanesForWidth("dense", width)).toBeGreaterThan(
        lanesForWidth("comfortable", width),
      );
    }
    expect(lanesForWidth("comfortable", 1400)).toBe(6);
    expect(lanesForWidth("dense", 1400)).toBe(8);
    expect(lanesForWidth("comfortable", 320)).toBe(2);
    expect(lanesForWidth("dense", 320)).toBe(3);
  });

  it("declares the same columns in the class string as in the lane table", () => {
    for (const density of DENSITIES) {
      expect(lanesFromClassName(gridClassFor(density))).toEqual([
        ...laneTable(density),
      ]);
    }
  });

  it("tightens the gutters as the covers shrink", () => {
    expect(gapFor("comfortable", 2)).toBe("0.75rem");
    expect(gapFor("comfortable", 6)).toBe("1rem");
    expect(gapFor("dense", 8)).toBe("0.75rem");
    expect(gapFor("dense", 3)).toBe("0.5rem");
  });
});

/*
 * 寸 · The covers' `sizes` comes from the same table and the same class
 * string as the grid. If it drifted, a tile would ask for a rendition
 * that is too small (blurred covers) or too large (the bytes this was
 * meant to save).
 */
describe("coverSizesFor", () => {
  it("reads the gaps off the grid's own classes", () => {
    expect(gapsFromClassName(gridClassFor("comfortable"))).toEqual([
      { min: 640, px: 16 },
      { min: 0, px: 12 },
    ]);
    expect(gapsFromClassName(gridClassFor("dense"))).toEqual([
      { min: 640, px: 12 },
      { min: 0, px: 8 },
    ]);
  });

  it("names one width per breakpoint of the lane table", () => {
    for (const density of ["comfortable", "dense"]) {
      const sizes = coverSizesFor(density).split(", ");
      expect(sizes).toHaveLength(laneTable(density).length);
      // The last entry is the unconditional default; the others are
      // media conditions, widest first.
      expect(sizes.at(-1)).not.toMatch(/^\(min-width/);
    }
  });

  it("gives a desktop tile its pixel width inside the 1280 px container", () => {
    // (1280 − 2×24 − 5×16) / 6 = 192 — the tile measured in the browser.
    expect(coverSizesFor("comfortable").split(", ")[0]).toBe(
      "(min-width: 1280px) 192px",
    );
    // (1280 − 2×24 − 7×12) / 8 = 143.5 → 144.
    expect(coverSizesFor("dense").split(", ")[0]).toBe(
      "(min-width: 1280px) 144px",
    );
  });

  it("spends the phone's padding and gap on two lanes", () => {
    expect(coverSizesFor("comfortable").split(", ").at(-1)).toBe(
      "calc((100vw - 44px) / 2)",
    );
  });
});
