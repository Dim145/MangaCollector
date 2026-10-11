import { describe, expect, it } from "vitest";
import { bandLayout, niceTicks, ringPath, ringSegments, roundedTopBar } from "./scale.js";

describe("niceTicks", () => {
  it("reaches the maximum in round steps", () => {
    expect(niceTicks(12)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(7.3)).toEqual([0, 2, 4, 6, 8]);
  });

  it("keeps whole steps for counts", () => {
    expect(niceTicks(3, { integers: true })).toEqual([0, 1, 2, 3]);
    expect(niceTicks(2, { integers: true })).toEqual([0, 1, 2]);
  });

  it("draws an axis even with nothing to show", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
  });
});

describe("bandLayout", () => {
  it("centres each bar in its band", () => {
    const { band, bar, x } = bandLayout(4, 400, { gap: 0.2 });
    expect(band).toBe(100);
    expect(bar).toBe(80);
    expect(x(0)).toBe(10);
    expect(x(3)).toBe(310);
  });
});

describe("roundedTopBar", () => {
  it("is empty for a bar of no height", () => {
    expect(roundedTopBar(0, 10, 20, 0, 4)).toBe("");
  });

  it("never rounds more than the bar can hold", () => {
    const d = roundedTopBar(0, 0, 6, 2, 10);
    expect(d).toContain("V2");
    expect(d).toContain("Q0,0 2,0");
  });
});

describe("rings", () => {
  it("splits the turn between the values, minus the padding", () => {
    const segments = ringSegments([1, 1, 2], { padDegrees: 0 });
    expect(segments.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(segments[2].end - segments[2].start).toBeCloseTo(Math.PI, 6);
    expect(segments.at(-1).end).toBeCloseTo(Math.PI * 2, 6);
  });

  it("skips zeros and pads only between live segments", () => {
    const segments = ringSegments([0, 3, 0], { padDegrees: 2 });
    expect(segments).toHaveLength(1);
    expect(segments[0].end - segments[0].start).toBeCloseTo(Math.PI * 2, 6);
    expect(ringSegments([0, 0])).toEqual([]);
  });

  it("draws a full ring in two arcs", () => {
    const d = ringPath(100, 100, 50, 80, 0, Math.PI * 2);
    expect(d.match(/M/g)).toHaveLength(2);
  });
});
