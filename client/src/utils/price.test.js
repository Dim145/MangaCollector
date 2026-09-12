import { describe, expect, it } from "vitest";
import { formatCurrency } from "./price.js";

/*
 * `formatCurrency` wraps currency.js. Two subtleties are load-bearing
 * and both are regression-prone, so they get explicit coverage:
 *
 *  1. Prices arrive from the Rust backend as STRINGS ("7.00", because
 *     rust_decimal serialises that way). Handing a string straight to
 *     currency.js makes it re-parse with the configured separators —
 *     with EUR settings that silently multiplies the value by 100.
 *  2. The config falls back with `??`, not `||`, so a legitimately
 *     falsy setting (JPY's `precision: 0`, an empty symbol) survives.
 */

// Exactly the payload the server emits for EUR — see
// `server/src/services/settings.rs` and the `#[serde(rename)]` on
// `negative_pattern` in `models/setting.rs`. Keeping the fixture
// byte-faithful to the wire shape is the point: a client-side mirror
// that drifts from it (as `SettingsPage`'s did, spelling the key
// `negative_pattern`) silently loses the setting.
const EUR = {
  code: "EUR",
  symbol: "€",
  separator: " ",
  decimal: ",",
  precision: 2,
  format: "#!",
  negativePattern: "-#!",
};

describe("formatCurrency", () => {
  it("formats a number with the default USD settings", () => {
    expect(formatCurrency(7)).toBe("$7.00");
  });

  it("formats a string amount without inflating it by 100", () => {
    // The regression this guards: currency("7.00", {decimal: ","})
    // used to read the dot as a thousands separator → "700,00 €".
    expect(formatCurrency("7.00", EUR)).toBe("7,00€");
    expect(formatCurrency("7.00", EUR)).not.toContain("700");
  });

  it("agrees between the string and number forms of the same amount", () => {
    expect(formatCurrency("12.34", EUR)).toBe(formatCurrency(12.34, EUR));
  });

  it.each([[null], [undefined], [""], ["abc"], [NaN]])(
    "renders %p as zero rather than NaN",
    (input) => {
      expect(formatCurrency(input, EUR)).toBe("0,00€");
    },
  );

  it("honours a zero-decimal currency", () => {
    // `precision: 0` is falsy — the `??` fallback is what keeps it
    // from being clobbered by the default of 2.
    const jpy = { code: "JPY", symbol: "¥", separator: ",", decimal: ".", precision: 0, format: "!#" };
    expect(formatCurrency(1500, jpy)).toBe("¥1,500");
  });

  it("honours an empty symbol", () => {
    const bare = { code: "EUR", symbol: "", separator: " ", decimal: ",", precision: 2, format: "!#" };
    expect(formatCurrency(9.5, bare)).toBe("9,50");
  });

  it("places the symbol per the configured pattern", () => {
    const suffix = { ...EUR, format: "#!" };
    const prefix = { ...EUR, format: "!#" };
    expect(formatCurrency(5, suffix)).toBe("5,00€");
    expect(formatCurrency(5, prefix)).toBe("€5,00");
  });

  it("applies the thousands separator", () => {
    expect(formatCurrency(1234567.89, EUR)).toBe("1 234 567,89€");
  });

  it("formats negative amounts with the configured negative pattern", () => {
    expect(formatCurrency(-5, EUR)).toBe("-5,00€");
  });

  it("keeps the symbol on the same side for positive and negative amounts", () => {
    // Regression guard for the `negative_pattern` / `negativePattern`
    // key mismatch: with the wrong spelling the override was dropped,
    // the default "-!#" took over, and a EUR user saw "5,00€" next to
    // "-€5,00" — the symbol jumping sides between two adjacent cells
    // of the same table.
    expect(formatCurrency(5, EUR).endsWith("€")).toBe(true);
    expect(formatCurrency(-5, EUR).endsWith("€")).toBe(true);
  });

  it("falls back to a leading-symbol negative pattern when none is configured", () => {
    const noNegative = { ...EUR };
    delete noNegative.negativePattern;
    expect(formatCurrency(-5, noNegative)).toBe("-€5,00");
  });

  it("falls back to USD defaults when no config object is given", () => {
    expect(formatCurrency(1234.5, undefined)).toBe("$1,234.50");
    expect(formatCurrency(1234.5, null)).toBe("$1,234.50");
  });
});
