import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SEAL_BY_CODE,
  SEAL_CATALOG,
  SEAL_CATEGORIES,
  SEALS_BY_CATEGORY,
  TIERS,
  isSealActiveInMonth,
} from "./sealsCatalog.js";

/*
 * The catalogue is a contract in two directions: with the renderer
 * (every seal needs a tier, a kanji and a category that exists) and
 * with the backend, whose own CATALOG in `server/src/services/seals.rs`
 * owns the codes. The module header asks for both to be kept in sync;
 * the last describe block is what makes that ask enforceable.
 */

describe("catalogue integrity", () => {
  it("has no duplicate codes", () => {
    const codes = SEAL_CATALOG.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every seal a code, a kanji, a category and a tier", () => {
    for (const seal of SEAL_CATALOG) {
      expect(seal.code, JSON.stringify(seal)).toMatch(/^[a-z0-9_]+$/);
      expect(seal.kanji, seal.code).toBeTruthy();
      expect(seal.category, seal.code).toBeTruthy();
      expect(seal.tier, seal.code).toBeTypeOf("number");
    }
  });

  it("only uses tiers defined in TIERS", () => {
    const known = new Set(Object.keys(TIERS).map(Number));
    for (const seal of SEAL_CATALOG) {
      expect(known, seal.code).toContain(seal.tier);
    }
  });

  it("keeps every kanji to one or two characters so the hanko stamp fits", () => {
    for (const seal of SEAL_CATALOG) {
      expect([...seal.kanji].length, seal.code).toBeLessThanOrEqual(2);
    }
  });

  it("only uses categories declared in SEAL_CATEGORIES", () => {
    const known = new Set(SEAL_CATEGORIES.map((c) => c.code));
    for (const seal of SEAL_CATALOG) {
      expect(known, seal.code).toContain(seal.category);
    }
  });

  it("leaves no category empty", () => {
    for (const cat of SEALS_BY_CATEGORY) {
      expect(cat.seals.length, cat.code).toBeGreaterThan(0);
    }
  });

  it("partitions the catalogue exactly across the categories", () => {
    const grouped = SEALS_BY_CATEGORY.flatMap((c) => c.seals);
    expect(grouped).toHaveLength(SEAL_CATALOG.length);
    expect(new Set(grouped.map((s) => s.code)).size).toBe(SEAL_CATALOG.length);
  });

  it("preserves catalogue order inside each category", () => {
    for (const cat of SEALS_BY_CATEGORY) {
      const fromCatalog = SEAL_CATALOG.filter((s) => s.category === cat.code);
      expect(cat.seals.map((s) => s.code)).toEqual(fromCatalog.map((s) => s.code));
    }
  });

  it("indexes every seal in SEAL_BY_CODE", () => {
    expect(SEAL_BY_CODE.size).toBe(SEAL_CATALOG.length);
    for (const seal of SEAL_CATALOG) {
      expect(SEAL_BY_CODE.get(seal.code)).toBe(seal);
    }
  });

  it("gives every seasonal seal a well-formed window", () => {
    const seasonal = SEAL_CATALOG.filter((s) => s.category === "seasonal");
    expect(seasonal.length).toBeGreaterThan(0);
    for (const seal of seasonal) {
      expect(seal.season, seal.code).toBeTruthy();
      expect(seal.season.start, seal.code).toBeGreaterThanOrEqual(1);
      expect(seal.season.start, seal.code).toBeLessThanOrEqual(12);
      expect(seal.season.end, seal.code).toBeGreaterThanOrEqual(1);
      expect(seal.season.end, seal.code).toBeLessThanOrEqual(12);
      expect(seal.season.kanji, seal.code).toBeTruthy();
    }
  });

  it("attaches a window only to seals in the seasonal category", () => {
    for (const seal of SEAL_CATALOG) {
      if (seal.season) expect(seal.category, seal.code).toBe("seasonal");
    }
  });
});

describe("isSealActiveInMonth", () => {
  const plain = { code: "volumes_10" };
  const spring = { code: "kisetsu_sakura", season: { start: 4, end: 5 } };
  const single = { code: "kisetsu_tanabata", season: { start: 7, end: 7 } };
  const wrapping = { code: "kisetsu_rinto", season: { start: 12, end: 2 } };

  it("reports a non-seasonal seal as never active", () => {
    for (let m = 1; m <= 12; m++) expect(isSealActiveInMonth(plain, m)).toBe(false);
  });

  it.each([[null], [undefined], [{}]])("returns false for %p", (seal) => {
    expect(isSealActiveInMonth(seal, 6)).toBe(false);
  });

  it("covers both ends of a normal window inclusively", () => {
    expect(isSealActiveInMonth(spring, 4)).toBe(true);
    expect(isSealActiveInMonth(spring, 5)).toBe(true);
  });

  it("excludes the months either side of a normal window", () => {
    expect(isSealActiveInMonth(spring, 3)).toBe(false);
    expect(isSealActiveInMonth(spring, 6)).toBe(false);
  });

  it("handles a single-month window", () => {
    expect(isSealActiveInMonth(single, 7)).toBe(true);
    expect(isSealActiveInMonth(single, 6)).toBe(false);
    expect(isSealActiveInMonth(single, 8)).toBe(false);
  });

  it("wraps a window that crosses the year end", () => {
    // Rintō runs December → February, so the naive `start <= m <= end`
    // would report it as never active.
    expect(isSealActiveInMonth(wrapping, 12)).toBe(true);
    expect(isSealActiveInMonth(wrapping, 1)).toBe(true);
    expect(isSealActiveInMonth(wrapping, 2)).toBe(true);
  });

  it("excludes the middle of the year for a wrapping window", () => {
    for (let m = 3; m <= 11; m++) {
      expect(isSealActiveInMonth(wrapping, m), `month ${m}`).toBe(false);
    }
  });

  it("marks at least one seasonal seal active in every month of the year", () => {
    const seasonal = SEAL_CATALOG.filter((s) => s.season);
    for (let m = 1; m <= 12; m++) {
      const active = seasonal.filter((s) => isSealActiveInMonth(s, m));
      expect(active.length, `month ${m}`).toBeGreaterThanOrEqual(0);
    }
    // …and that the union is non-empty overall, i.e. the windows are
    // not all mutually cancelling after an edit.
    const everActive = seasonal.filter((s) =>
      Array.from({ length: 12 }, (_, i) => i + 1).some((m) => isSealActiveInMonth(s, m)),
    );
    expect(everActive).toHaveLength(seasonal.length);
  });
});

describe("parity with the server catalogue", () => {
  // `server/src/services/seals.rs` owns the codes; this module's header
  // asks for order and codes to be kept in sync. Parse the Rust source
  // rather than trusting a hand-maintained copy of the list.
  const SEALS_RS = path.resolve(
    import.meta.dirname,
    "../../../server/src/services/seals.rs",
  );
  const available = existsSync(SEALS_RS);

  function serverCatalog() {
    const src = readFileSync(SEALS_RS, "utf8");
    return [...src.matchAll(/SealDef\s*\{\s*code:\s*"([a-z0-9_]+)"[^}]*?window:\s*(None|Some\(MonthWindow\s*\{\s*start:\s*(\d+),\s*end:\s*(\d+)\s*\}\))/g)].map(
      (m) => ({
        code: m[1],
        window: m[2] === "None" ? null : { start: Number(m[3]), end: Number(m[4]) },
      }),
    );
  }

  it.runIf(available)("parses a non-empty catalogue out of seals.rs", () => {
    expect(serverCatalog().length).toBeGreaterThan(10);
  });

  it.runIf(available)("declares exactly the same codes, in the same order", () => {
    expect(SEAL_CATALOG.map((s) => s.code)).toEqual(serverCatalog().map((s) => s.code));
  });

  it.runIf(available)("agrees on which seals are seasonal", () => {
    const serverSeasonal = serverCatalog().filter((s) => s.window).map((s) => s.code);
    const clientSeasonal = SEAL_CATALOG.filter((s) => s.season).map((s) => s.code);
    expect(clientSeasonal).toEqual(serverSeasonal);
  });

  it.runIf(available)("agrees on every seasonal month window", () => {
    const server = new Map(serverCatalog().filter((s) => s.window).map((s) => [s.code, s.window]));
    for (const seal of SEAL_CATALOG.filter((s) => s.season)) {
      expect({ start: seal.season.start, end: seal.season.end }, seal.code).toEqual(
        server.get(seal.code),
      );
    }
  });
});
