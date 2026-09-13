import { describe, expect, it } from "vitest";
import {
  DEFAULT_DENSITY,
  DENSITIES,
  gapFor,
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
