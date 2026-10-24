# Currency · 銭

> One display currency per account. It changes how prices are **written**, never what is stored.

## What it is

`settings.currency` holds a code from a closed catalogue: `USD`, `EUR`, `JPY`. The server turns the code into a
`CurrencyInfo` (symbol, thousands separator, decimal mark, precision, symbol position, negative pattern) in
`get_currency_by_code` (`server/src/services/settings.rs`) and sends that object with the settings. The client formats
every amount from the object (`client/src/utils/price.js`, built on `currency.js`).

| Code | Written as | Precision |
|---|---|---|
| `USD` | `$1,200.00` | 2 |
| `EUR` | `1 200,00€` | 2 |
| `JPY` | `¥1,200` | 0 |

## Nothing is converted

Prices are stored as `DECIMAL(12,2)` in `user_volumes.price` (and `coffrets.price`) with no currency attached. Switching
the display currency changes the symbol and the number of decimals shown and nothing else: 1200 stays 1200. There is no
exchange-rate code anywhere. The settings screen says so under the picker.

Because a number that reads `$12.50` today and `¥13` tomorrow can look like a conversion, the settings page asks first
when this device's synced copy of the library holds any price above zero (volumes or boxsets): it states how many prices
there are, that they are not converted, and shows the first one written both ways. With no saved price the switch is
immediate, and choosing the currency already in use does nothing (`client/src/lib/currencySwitch.js`).

A zero-decimal currency rounds **for display only** (a stored `12.50` reads `¥13` in JPY). The price inputs use
`step="1"` in JPY (`priceInputStep`) so the browser refuses fractions in the first place.

## Adding a currency

A code lives in four places; `client/src/utils/currencyCatalogue.test.js` reads all four and fails when they disagree:

1. `get_currency_by_code` in `server/src/services/settings.rs` (and its test).
2. The `settings_currency_check` constraint on `settings.currency` — a new migration that drops and re-adds it
   (`20261024100000_settings_currency_jpy.sql` is the template).
3. `CURRENCIES` in `client/src/components/settings/ChapterContent.jsx` (the picker).
4. `CURRENCY_FORMATS` in `client/src/components/SettingsPage.jsx` (the optimistic mirror), plus the
   `settings.currency<CODE>` label in every language file.

## Rolling back past the JPY migration

The migration only widens a CHECK constraint; it touches no row. To run an older server again:

1. Make sure no account uses a code the older server does not know. An older server shows an unknown code as USD
   (`get_user_settings` falls back), which would mislabel yen amounts as dollars:
   `UPDATE settings SET currency = 'USD' WHERE currency = 'JPY';`
2. Restore the narrower constraint:
   `ALTER TABLE settings DROP CONSTRAINT settings_currency_check;`
   `ALTER TABLE settings ADD CONSTRAINT settings_currency_check CHECK (currency IN ('USD','EUR'));`
3. Remove the migration record, or the older binary refuses to start (`sqlx` reports an applied migration it cannot
   find): `DELETE FROM _sqlx_migrations WHERE version = 20261024100000;`
4. Start the older image.

A database backup taken before the upgrade makes steps 1–3 unnecessary: restore it instead.
