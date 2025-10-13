const AVAILABLE_CURRENCIES = [
  {
    code: 'USD',
    symbol: '$',
    separator: ".",
    decimal: ",",
    precision: 2,
    format: "!#",
    negativePattern: "-!#"
  },
  {
    code: 'EUR',
    symbol: "€",
    separator: " ",
    decimal: ",",
    precision: 2,
    format: "#!",
    negativePattern: "-#!"
  }
];

const getCurrenciesCodes = () => AVAILABLE_CURRENCIES.map(c => c.code);
const getCurrencyByCode = (code) => AVAILABLE_CURRENCIES.find(c => c.code === code);

module.exports = {
  AVAILABLE_CURRENCIES,
  getCurrenciesCodes,
  getCurrencyByCode
}
