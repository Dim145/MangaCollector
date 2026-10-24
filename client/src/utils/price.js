import currency from "currency.js";

/**
 * `step` / `placeholder` for a price `<input type="number">` in the
 * account's currency: whole units for a zero-decimal currency (JPY), two
 * decimals otherwise. The browser then refuses 12.5 yen instead of the
 * server storing it and the display rounding it away.
 */
export function priceInputStep(formatObject) {
  const precision = formatObject?.precision ?? 2;
  return precision <= 0 ? "1" : String(Math.pow(10, -precision));
}

export function priceInputPlaceholder(formatObject) {
  const precision = formatObject?.precision ?? 2;
  return precision <= 0 ? "0" : `0.${"0".repeat(precision)}`;
}

export function formatCurrency(amount, formatObject) {
  // Coerce to Number first — prices may arrive as strings from the API
  // (rust_decimal serializes to "7.00"). Passing the string directly to
  // currency.js makes it re-parse using the configured locale separators,
  // which can multiply the visible value by 100 with EUR settings.
  const safeAmount = Number(amount) || 0;

  // `??` (not `||`) so legitimately-falsy config survives: a
  // zero-decimal currency (JPY/KRW → `precision: 0`) and a no-separator
  // or empty-symbol locale would otherwise be clobbered by the default.
  // `safeAmount` above stays `||` on purpose — `NaN ?? 0` keeps NaN.
  const tmp = currency(safeAmount, {
    code: formatObject?.code ?? "USD",
    symbol: formatObject?.symbol ?? "$",
    separator: formatObject?.separator ?? ",",
    decimal: formatObject?.decimal ?? ".",
    precision: formatObject?.precision ?? 2,
    pattern: formatObject?.format ?? "!#",
    negativePattern: formatObject?.negativePattern ?? "-!#",
  });

  return tmp.s?.format(tmp, tmp.s);
}
