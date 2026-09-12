import { afterEach, describe, expect, it, vi } from "vitest";
import { dailyIndex, pickBracket } from "./dailyTexts.js";

/*
 * The two pure helpers behind the daily prose. `dailyIndex` has one
 * job that is easy to get subtly wrong: be stable for a whole calendar
 * day, change when the day does, and give different seeds different
 * answers on the same day — otherwise every surface on the profile
 * page shows the same line.
 *
 * The hooks in this module are covered indirectly: they are thin
 * `useMemo` wrappers over `dailyIndex` and a language bank.
 */

const DAY_MS = 86_400_000;

describe("dailyIndex", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (iso) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  it.each([[0], [-1], [null], [undefined], [NaN]])(
    "returns 0 for the invalid length %p",
    (len) => {
      expect(dailyIndex("seed", len)).toBe(0);
    },
  );

  it("stays in range for any length", () => {
    for (let len = 1; len <= 40; len++) {
      const i = dailyIndex("seed", len);
      expect(i, `len=${len}`).toBeGreaterThanOrEqual(0);
      expect(i, `len=${len}`).toBeLessThan(len);
    }
  });

  it("is stable across the whole of one day", () => {
    at("2026-06-15T00:00:01Z");
    const early = dailyIndex("byline", 10);
    at("2026-06-15T12:00:00Z");
    expect(dailyIndex("byline", 10)).toBe(early);
    at("2026-06-15T23:59:59Z");
    expect(dailyIndex("byline", 10)).toBe(early);
  });

  it("is repeatable within a single instant", () => {
    at("2026-06-15T12:00:00Z");
    expect(dailyIndex("byline", 10)).toBe(dailyIndex("byline", 10));
  });

  it("changes as the days go by", () => {
    // Not every consecutive pair differs (a 10-slot bank collides one
    // day in ten), so assert variety over a run rather than per step.
    const seen = new Set();
    for (let d = 0; d < 30; d++) {
      at(new Date(Date.parse("2026-06-15T12:00:00Z") + d * DAY_MS).toISOString());
      seen.add(dailyIndex("byline", 10));
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it("advances by exactly one slot per day for a bank larger than the run", () => {
    at("2026-06-15T12:00:00Z");
    const first = dailyIndex("byline", 1000);
    at("2026-06-16T12:00:00Z");
    expect(dailyIndex("byline", 1000)).toBe((first + 1) % 1000);
  });

  it("gives different seeds different answers on the same day", () => {
    // Otherwise the byline, the stats subtitle and the insight would
    // all land on the same index every day.
    at("2026-06-15T12:00:00Z");
    const seeds = ["byline", "stats", "insight-complete", "insight-beginning"];
    const values = seeds.map((s) => dailyIndex(s, 50));
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it("spreads a single seed across the whole bank over a year", () => {
    const seen = new Set();
    for (let d = 0; d < 365; d++) {
      at(new Date(Date.parse("2026-01-01T12:00:00Z") + d * DAY_MS).toISOString());
      seen.add(dailyIndex("byline", 8));
    }
    expect(seen.size).toBe(8);
  });

  it("handles a single-entry bank", () => {
    at("2026-06-15T12:00:00Z");
    expect(dailyIndex("byline", 1)).toBe(0);
  });

  it("does not throw on an unusual seed", () => {
    at("2026-06-15T12:00:00Z");
    for (const seed of ["", "é", "🎌", "a".repeat(500)]) {
      expect(() => dailyIndex(seed, 10)).not.toThrow();
      expect(dailyIndex(seed, 10)).toBeLessThan(10);
    }
  });
});

describe("pickBracket", () => {
  it.each([
    [{ totalVolumesOwned: 0, completionRate: 0 }, "empty"],
    [{ totalVolumesOwned: 0, completionRate: 100 }, "empty"],
    [{ totalVolumesOwned: 10, completionRate: 100 }, "complete"],
    [{ totalVolumesOwned: 10, completionRate: 99 }, "almost"],
    [{ totalVolumesOwned: 10, completionRate: 76 }, "almost"],
    [{ totalVolumesOwned: 10, completionRate: 75 }, "halfway"],
    [{ totalVolumesOwned: 10, completionRate: 51 }, "halfway"],
    [{ totalVolumesOwned: 10, completionRate: 50 }, "beginning"],
    [{ totalVolumesOwned: 10, completionRate: 0 }, "beginning"],
  ])("maps %j to %s", (input, expected) => {
    expect(pickBracket(input)).toBe(expected);
  });

  it("puts an empty collection in the empty bracket whatever the rate says", () => {
    // Owning nothing is checked first on purpose: a 100% rate over zero
    // volumes is arithmetic noise, not a completed collection.
    expect(pickBracket({ totalVolumesOwned: 0, completionRate: 100 })).toBe("empty");
  });

  it.each([[undefined], [null]])("treats a missing owned count (%p) as empty", (v) => {
    expect(pickBracket({ totalVolumesOwned: v, completionRate: 50 })).toBe("empty");
  });

  it("never returns undefined for any rate", () => {
    const valid = new Set(["empty", "complete", "almost", "halfway", "beginning"]);
    for (let rate = 0; rate <= 100; rate++) {
      expect(valid, `rate=${rate}`).toContain(
        pickBracket({ totalVolumesOwned: 5, completionRate: rate }),
      );
    }
  });

  it("is monotonic — a higher rate never moves the bracket backwards", () => {
    const order = ["beginning", "halfway", "almost", "complete"];
    let last = -1;
    for (let rate = 0; rate <= 100; rate++) {
      const idx = order.indexOf(pickBracket({ totalVolumesOwned: 5, completionRate: rate }));
      expect(idx, `rate=${rate}`).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });
});
