import { describe, expect, it } from "vitest";
import { coverPaletteFor } from "./coverPalette.js";

/*
 * Deterministic LQIP swatch per series. The contract that matters to
 * the UI is stability (same series → same colour across reloads and
 * devices) and total coverage (never undefined, including for the
 * negative ids custom entries use).
 */

const RGB = /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/;

describe("coverPaletteFor", () => {
  it("returns a well-formed rgb() string", () => {
    expect(coverPaletteFor(1)).toMatch(RGB);
  });

  it("is deterministic for a given id", () => {
    expect(coverPaletteFor(4242)).toBe(coverPaletteFor(4242));
  });

  it.each([[null], [undefined]])(
    "returns the fallback swatch for %p rather than undefined",
    (input) => {
      expect(coverPaletteFor(input)).toMatch(RGB);
    },
  );

  it("gives a negative custom id the same swatch as its positive twin", () => {
    // Custom (non-MAL) series carry a negative mal_id; Math.abs is what
    // keeps them inside the palette instead of indexing out of range.
    expect(coverPaletteFor(-7)).toBe(coverPaletteFor(7));
  });

  it("never returns undefined for any id in a wide range", () => {
    for (let id = -500; id <= 500; id++) {
      expect(coverPaletteFor(id)).toMatch(RGB);
    }
  });

  it("uses exactly 8 distinct swatches", () => {
    const seen = new Set();
    for (let id = 0; id < 200; id++) seen.add(coverPaletteFor(id));
    expect(seen.size).toBe(8);
  });

  it("distributes ids evenly across the palette", () => {
    // The palette length is a power of 2 precisely so the modulo is
    // bias-free; an off-by-one in its length would show up here.
    const counts = new Map();
    for (let id = 0; id < 800; id++) {
      const c = coverPaletteFor(id);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    for (const n of counts.values()) expect(n).toBe(100);
  });

  it("cycles with a period of 8", () => {
    expect(coverPaletteFor(3)).toBe(coverPaletteFor(11));
    expect(coverPaletteFor(3)).toBe(coverPaletteFor(19));
  });

  it("truncates a non-integer id rather than returning undefined", () => {
    expect(coverPaletteFor(3.7)).toBe(coverPaletteFor(3));
  });
});
