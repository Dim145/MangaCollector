-- 円 · The yen joins the currencies a library can be priced in.
--
-- `settings.currency` is constrained to the codes the server's catalogue
-- (`services::settings::get_currency_by_code`) knows. Widening the
-- constraint is the whole schema change: no column, no data and no
-- existing row is touched, so nothing is converted — a library that was
-- priced in USD stays at the same stored amounts and is merely shown with
-- another symbol if its owner switches the display currency.
--
-- Idempotent (DROP IF EXISTS), and the constraint name is the one
-- Postgres derived from the inline CHECK in `20251012214941_add_settings`.
--
-- Rolling back past this migration: set `settings.currency` back to one
-- of 'USD'/'EUR' first, then restore the old constraint — see
-- docs/modules/currency.md.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_currency_check;
ALTER TABLE settings
    ADD CONSTRAINT settings_currency_check
    CHECK (currency IN ('USD', 'EUR', 'JPY'));
