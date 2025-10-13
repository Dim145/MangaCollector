import currency from "currency.js";

export function formatCurrency(amount, formatObject)
{
  const tmp = currency(amount,{
    code: formatObject?.code || 'USD',
    symbol: formatObject?.symbol || '$',
    separator: formatObject?.separator || ',',
    decimal: formatObject?.decimal || '.',
    precision: formatObject?.precision || 2,
    pattern: formatObject?.format || '!#',
    negativePattern: formatObject?.negativePattern || '-!#',
  });

  return tmp.s?.format(tmp, tmp.s)
}
