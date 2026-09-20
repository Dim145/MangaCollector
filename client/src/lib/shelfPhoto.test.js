import { describe, expect, it } from "vitest";
import { MAX_EDGE, fitWithin } from "./shelfPhoto.js";

describe("fitWithin", () => {
  it("leaves an image already inside the box alone", () => {
    expect(fitWithin(800, 600)).toEqual({
      width: 800,
      height: 600,
      scaled: false,
    });
    // Exactly on the edge is inside it.
    expect(fitWithin(MAX_EDGE, 900).scaled).toBe(false);
  });

  it("scales the long edge down and keeps the ratio", () => {
    const box = fitWithin(4032, 3024);
    expect(box).toEqual({ width: 1600, height: 1200, scaled: true });
    expect(box.width / box.height).toBeCloseTo(4032 / 3024, 5);
  });

  it("measures the long edge, not the width", () => {
    // A portrait shot: the height is what has to come down.
    expect(fitWithin(3024, 4032)).toEqual({
      width: 1200,
      height: 1600,
      scaled: true,
    });
  });

  it("never rounds an edge to zero", () => {
    // A panorama: 3 / 6000 × 1600 rounds to 0.8, and a canvas of width
    // 0 throws in drawImage rather than producing a thin image.
    expect(fitWithin(6000, 3).height).toBe(1);
  });

  it("refuses a size it cannot use", () => {
    expect(fitWithin(0, 100)).toBeNull();
    expect(fitWithin(undefined, undefined)).toBeNull();
    expect(fitWithin(-10, 10)).toBeNull();
  });

  it("takes the ceiling from its caller", () => {
    expect(fitWithin(2000, 1000, 500)).toEqual({
      width: 500,
      height: 250,
      scaled: true,
    });
  });
});
