import currency from "currency.js";

export function formatCurrency(amount, formatObject) {
  // Coerce to Number first — prices may arrive as strings from the API
  // (rust_decimal serializes to "7.00"). Passing the string directly to
  // currency.js makes it re-parse using the configured locale separators,
  // which can multiply the visible value by 100 with EUR settings.
  const safeAmount = Number(amount) || 0;

  const tmp = currency(safeAmount, {
    code: formatObject?.code || "USD",
    symbol: formatObject?.symbol || "$",
    separator: formatObject?.separator || ",",
    decimal: formatObject?.decimal || ".",
    precision: formatObject?.precision || 2,
    pattern: formatObject?.format || "!#",
    negativePattern: formatObject?.negativePattern || "-!#",
  });

  return tmp.s?.format(tmp, tmp.s);
}
