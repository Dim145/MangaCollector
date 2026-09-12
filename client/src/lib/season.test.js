import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentSeason,
  hasGreetedSeason,
  isInSeasonTransition,
  isSouthernHemisphere,
  markSeasonGreeted,
} from "./season.js";

/*
 * Astronomical seasons from the Meeus mean-equinox polynomial. The
 * module has no I/O beyond the timezone lookup and localStorage, so
 * everything here is exercised against real dates rather than fixtures.
 *
 * Reference instants for 2026 (UTC): March equinox ~20 Mar, June
 * solstice ~21 Jun, September equinox ~22 Sep, December solstice
 * ~21 Dec. Assertions stay several days clear of those boundaries so
 * the ~±20 min polynomial error can never flip a case.
 */

const utc = (s) => new Date(`${s}T12:00:00Z`);

/** Force the hemisphere by stubbing the resolved IANA timezone. */
function withTimeZone(tz, fn) {
  const real = Intl.DateTimeFormat;
  const spy = vi
    .spyOn(Intl, "DateTimeFormat")
    .mockImplementation((...args) => {
      const inst = new real(...args);
      inst.resolvedOptions = () => ({ ...new real(...args).resolvedOptions(), timeZone: tz });
      return inst;
    });
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

describe("isSouthernHemisphere", () => {
  it.each([
    "Australia/Sydney",
    "Pacific/Auckland",
    "America/Argentina/Buenos_Aires",
    "America/Sao_Paulo",
    "America/Santiago",
    "Africa/Johannesburg",
    "Antarctica/Casey",
    "Atlantic/Stanley",
    "Indian/Reunion",
  ])("recognises %s as southern", (tz) => {
    expect(withTimeZone(tz, isSouthernHemisphere)).toBe(true);
  });

  it.each([
    "Europe/Paris",
    "America/New_York",
    "Asia/Tokyo",
    "UTC",
    "Africa/Cairo",
    "America/Mexico_City",
  ])("treats %s as northern", (tz) => {
    expect(withTimeZone(tz, isSouthernHemisphere)).toBe(false);
  });

  it("defaults to northern when the timezone cannot be resolved", () => {
    expect(withTimeZone(undefined, isSouthernHemisphere)).toBe(false);
  });

  it("defaults to northern rather than throwing when Intl blows up", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no ICU");
    });
    expect(() => isSouthernHemisphere()).not.toThrow();
    expect(isSouthernHemisphere()).toBe(false);
    spy.mockRestore();
  });
});

describe("getCurrentSeason", () => {
  const NORTHERN = "Europe/Paris";
  const SOUTHERN = "Australia/Sydney";

  it.each([
    ["2026-01-15", "winter"],
    ["2026-04-15", "spring"],
    ["2026-07-15", "summer"],
    ["2026-10-15", "autumn"],
    ["2026-12-28", "winter"],
  ])("maps %s to %s in the northern hemisphere", (date, season) => {
    expect(withTimeZone(NORTHERN, () => getCurrentSeason(utc(date)))).toBe(season);
  });

  it.each([
    ["2026-01-15", "summer"],
    ["2026-04-15", "autumn"],
    ["2026-07-15", "winter"],
    ["2026-10-15", "spring"],
    ["2026-12-28", "summer"],
  ])("inverts %s to %s in the southern hemisphere", (date, season) => {
    expect(withTimeZone(SOUTHERN, () => getCurrentSeason(utc(date)))).toBe(season);
  });

  it("is always the opposite season across the two hemispheres", () => {
    const opposites = {
      spring: "autumn",
      summer: "winter",
      autumn: "spring",
      winter: "summer",
    };
    for (const month of ["01", "03", "05", "07", "09", "11"]) {
      const day = utc(`2026-${month}-10`);
      const north = withTimeZone(NORTHERN, () => getCurrentSeason(day));
      const south = withTimeZone(SOUTHERN, () => getCurrentSeason(day));
      expect(south).toBe(opposites[north]);
    }
  });

  it("puts late December and early January in the same season", () => {
    // The year boundary falls INSIDE winter — the December branch and
    // the pre-March branch both have to answer "winter", or the banner
    // fires twice around New Year.
    const dec = withTimeZone(NORTHERN, () => getCurrentSeason(utc("2026-12-28")));
    const jan = withTimeZone(NORTHERN, () => getCurrentSeason(utc("2027-01-03")));
    expect(dec).toBe("winter");
    expect(jan).toBe("winter");
  });

  it("returns one of the four seasons for every day of a year", () => {
    const valid = new Set(["spring", "summer", "autumn", "winter"]);
    const d = new Date(Date.UTC(2026, 0, 1, 12));
    while (d.getUTCFullYear() === 2026) {
      expect(valid).toContain(withTimeZone(NORTHERN, () => getCurrentSeason(new Date(d))));
      d.setUTCDate(d.getUTCDate() + 1);
    }
  });

  it("agrees with itself across non-consecutive years", () => {
    for (const year of [2024, 2025, 2027, 2030]) {
      expect(withTimeZone(NORTHERN, () => getCurrentSeason(utc(`${year}-07-15`)))).toBe("summer");
    }
  });
});

describe("isInSeasonTransition", () => {
  it("is true on the day of an equinox", () => {
    expect(isInSeasonTransition(utc("2026-03-20"))).toBe(true);
  });

  it("is true inside the default 3-day window on either side", () => {
    expect(isInSeasonTransition(utc("2026-03-18"))).toBe(true);
    expect(isInSeasonTransition(utc("2026-03-22"))).toBe(true);
  });

  it("is false in the middle of a season", () => {
    expect(isInSeasonTransition(utc("2026-05-15"))).toBe(false);
    expect(isInSeasonTransition(utc("2026-08-01"))).toBe(false);
  });

  it("widens with an explicit windowDays", () => {
    expect(isInSeasonTransition(utc("2026-03-10"))).toBe(false);
    expect(isInSeasonTransition(utc("2026-03-10"), 15)).toBe(true);
  });

  it("is active for roughly 28 days a year at the default window", () => {
    // 4 events × a 7-day band. A regression in `nearestSeasonalEvents`
    // (e.g. losing the year-1 / year+1 padding) shows up here as a
    // wildly different count rather than a silent off-by-a-season.
    let active = 0;
    const d = new Date(Date.UTC(2026, 0, 1, 12));
    while (d.getUTCFullYear() === 2026) {
      if (isInSeasonTransition(new Date(d))) active += 1;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    expect(active).toBeGreaterThanOrEqual(24);
    expect(active).toBeLessThanOrEqual(32);
  });

  it("handles a date near the December solstice, which spans the year boundary", () => {
    expect(isInSeasonTransition(utc("2026-12-21"))).toBe(true);
    expect(isInSeasonTransition(utc("2027-01-01"))).toBe(false);
  });
});

describe("season greeting persistence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a season as not yet greeted on a fresh install", () => {
    expect(hasGreetedSeason("spring", utc("2026-04-15"))).toBe(false);
  });

  it("remembers a greeting within the same season and year", () => {
    markSeasonGreeted("spring", utc("2026-04-15"));
    expect(hasGreetedSeason("spring", utc("2026-05-20"))).toBe(true);
  });

  it("re-greets the same season a year later", () => {
    markSeasonGreeted("spring", utc("2026-04-15"));
    expect(hasGreetedSeason("spring", utc("2027-04-15"))).toBe(false);
  });

  it("re-greets when the season changes within the year", () => {
    markSeasonGreeted("spring", utc("2026-04-15"));
    expect(hasGreetedSeason("summer", utc("2026-07-15"))).toBe(false);
  });

  it("does not re-greet winter across the New Year flip", () => {
    // December's stamp is anchored on year+1 precisely so a greeting
    // shown on 28 Dec is not repeated on 2 Jan.
    markSeasonGreeted("winter", utc("2026-12-28"));
    expect(hasGreetedSeason("winter", utc("2027-01-02"))).toBe(true);
  });

  it("stores only a single key regardless of how often it is called", () => {
    markSeasonGreeted("spring", utc("2026-04-15"));
    markSeasonGreeted("summer", utc("2026-07-15"));
    expect(localStorage.length).toBe(1);
  });

  it("claims the season was greeted when localStorage is unreadable", () => {
    // Private mode: returning true is the deliberate choice — better a
    // missed banner than one that re-fires on every mount.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(hasGreetedSeason("spring", utc("2026-04-15"))).toBe(true);
  });

  it("does not throw when localStorage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => markSeasonGreeted("spring", utc("2026-04-15"))).not.toThrow();
  });
});
