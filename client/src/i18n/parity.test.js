import { describe, expect, it } from "vitest";
import en from "./en.js";
import es from "./es.js";
import fr from "./fr.js";

/*
 * 一 · The three catalogues must carry exactly the same keys.
 *
 * This is not tidiness — it is what lets the app ship one catalogue
 * per reader. `loadLanguage` used to fetch English alongside every
 * other language so that `t()`'s English fallback would be there
 * synchronously; that is 92 kB of JavaScript, 32 kB over the wire,
 * downloaded and parsed before the first screen paints, for a fallback
 * that only fires on a key one catalogue has and another lacks.
 *
 * If this test fails, either finish the translation or put the
 * co-load back. Do not delete the test.
 */

function keysOf(catalogue, prefix = "") {
  return Object.entries(catalogue).flatMap(([key, value]) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? keysOf(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

const catalogues = { en, fr, es };

describe("translation catalogues", () => {
  const reference = keysOf(en).sort();

  it("carry the same keys, all three", () => {
    expect(reference.length).toBeGreaterThan(2000);
    for (const [code, catalogue] of Object.entries(catalogues)) {
      const keys = keysOf(catalogue).sort();
      const missing = reference.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !reference.includes(k));
      expect({ code, missing, extra }).toEqual({
        code,
        missing: [],
        extra: [],
      });
    }
  });

  it("leave no value empty or untranslated-by-accident", () => {
    for (const [code, catalogue] of Object.entries(catalogues)) {
      const blanks = keysOf(catalogue).filter((key) => {
        const value = key
          .split(".")
          .reduce((node, part) => (node == null ? node : node[part]), catalogue);
        return typeof value === "string" && value.trim() === "";
      });
      expect({ code, blanks }).toEqual({ code, blanks: [] });
    }
  });
});
