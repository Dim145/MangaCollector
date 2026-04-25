-- 出版社 · publisher and edition metadata on user_libraries.
--
-- A series can be the same MAL entry but published in distinct
-- editions across regions (Glénat / Kana / Pika in France; Viz /
-- Yen Press in the US) and across formats (Standard / Kanzenban /
-- Perfect / Deluxe). Stored on the library row (series-level),
-- not on user_volumes — a coffret is the right tool for per-volume
-- collector packaging, this is for "which edition am I collecting".
--
-- Both columns are NULL-able free-text. The application layer trims
-- whitespace, treats "" as NULL, and clamps each value to a
-- reasonable maximum length. No CHECK constraint here so the cap
-- can evolve without a follow-up migration.
ALTER TABLE user_libraries
    ADD COLUMN publisher TEXT,
    ADD COLUMN edition TEXT;
