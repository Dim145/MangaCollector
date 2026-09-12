import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatCompactDate,
  formatLongDate,
  formatRelative,
  formatShortDate,
  formatTime,
  localeFor,
} from "./date.js";

/*
 * Locale-aware formatters. Assertions avoid pinning the exact ICU
 * output where it is cosmetic (separators and abbreviations shift
 * between Node/ICU releases) and instead pin the parts the UI
 * actually depends on: that the right locale was selected, that the
 * right fields are present, and that invalid input degrades to "".
 *
 * The suite runs under TZ=UTC (see `src/test/setup.js`) and uses
 * midday timestamps, so a date never slides across midnight.
 */

const REF = "2026-03-15T14:32:00Z"; // a Sunday

describe("localeFor", () => {
  it.each([
    ["fr", "fr-FR"],
    ["en", "en-US"],
    ["es", "es-ES"],
  ])("maps %s to %s", (lang, expected) => {
    expect(localeFor(lang)).toBe(expected);
  });

  it.each([[undefined], [null], ["de"], ["jp"], [""], [0]])(
    "falls back to en-US for the unsupported code %p",
    (lang) => {
      expect(localeFor(lang)).toBe("en-US");
    },
  );
});

describe("input handling", () => {
  const formatters = {
    formatShortDate,
    formatCompactDate,
    formatLongDate,
    formatTime,
    formatRelative,
  };

  for (const [name, fn] of Object.entries(formatters)) {
    describe(name, () => {
      it.each([[null], [undefined], [""], ["not a date"], [NaN]])(
        "returns an empty string for %p",
        (input) => {
          expect(fn(input, "en")).toBe("");
        },
      );

      it("accepts an ISO string, a Date and an epoch number alike", () => {
        const iso = fn(REF, "en");
        const date = fn(new Date(REF), "en");
        const epoch = fn(Date.parse(REF), "en");
        expect(iso).toBe(date);
        expect(date).toBe(epoch);
        expect(iso).not.toBe("");
      });
    });
  }
});

describe("formatShortDate", () => {
  it("renders day, abbreviated month and a 4-digit year", () => {
    const out = formatShortDate(REF, "en");
    expect(out).toContain("15");
    expect(out).toContain("2026");
    expect(out).toMatch(/Mar/i);
  });

  it("localises the month name", () => {
    expect(formatShortDate(REF, "fr")).toMatch(/mars/i);
    expect(formatShortDate(REF, "es")).toMatch(/mar/i);
  });
});

describe("formatCompactDate", () => {
  it("uses a 2-digit year to save horizontal space", () => {
    const out = formatCompactDate(REF, "en");
    expect(out).toContain("26");
    expect(out).not.toContain("2026");
  });

  it("is never longer than the short form it replaces", () => {
    expect(formatCompactDate(REF, "fr").length).toBeLessThanOrEqual(
      formatShortDate(REF, "fr").length,
    );
  });
});

describe("formatLongDate", () => {
  it("includes the weekday and the spelled-out month", () => {
    const out = formatLongDate(REF, "en");
    expect(out).toMatch(/Sunday/i);
    expect(out).toMatch(/March/i);
    expect(out).toContain("2026");
  });

  it("localises the weekday", () => {
    expect(formatLongDate(REF, "fr")).toMatch(/dimanche/i);
  });
});

describe("formatTime", () => {
  it("renders hours and minutes only", () => {
    const out = formatTime(REF, "fr");
    expect(out).toMatch(/^\d{2}:\d{2}$/);
    expect(out).toBe("14:32");
  });

  it("uses the locale's clock convention", () => {
    // en-US is 12-hour with a day period; fr-FR is 24-hour.
    expect(formatTime(REF, "en")).toMatch(/PM/i);
    expect(formatTime(REF, "fr")).not.toMatch(/PM/i);
  });
});

describe("formatRelative", () => {
  const NOW = new Date("2026-03-15T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
  const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString();

  it("uses seconds under a minute", () => {
    expect(formatRelative(ago(30_000), "en")).toMatch(/second/i);
  });

  it("uses minutes under an hour", () => {
    expect(formatRelative(ago(5 * 60_000), "en")).toMatch(/minute/i);
  });

  it("uses hours under a day", () => {
    expect(formatRelative(ago(5 * 3_600_000), "en")).toMatch(/hour/i);
  });

  it("uses days up to the 30-day cap", () => {
    expect(formatRelative(ago(3 * 86_400_000), "en")).toMatch(/day/i);
    expect(formatRelative(ago(30 * 86_400_000), "en")).toMatch(/day/i);
  });

  it("falls back to an absolute date beyond 30 days", () => {
    const old = ago(90 * 86_400_000);
    expect(formatRelative(old, "en")).toBe(formatShortDate(old, "en"));
  });

  it("handles future timestamps", () => {
    const out = formatRelative(ahead(2 * 3_600_000), "en");
    expect(out).toMatch(/in\b/i);
  });

  it("localises the phrasing", () => {
    expect(formatRelative(ago(3 * 86_400_000), "fr")).toMatch(/il y a/i);
    expect(formatRelative(ago(3 * 86_400_000), "es")).toMatch(/hace/i);
  });

  it("uses the idiomatic word for yesterday rather than '1 day ago'", () => {
    // `numeric: "auto"` is what buys this; a regression to
    // `numeric: "always"` would render "1 day ago".
    expect(formatRelative(ago(86_400_000), "en")).toMatch(/yesterday/i);
  });
});
