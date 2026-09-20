-- 帯 · The parts a Japanese edition comes with, and loses.
--
-- A tome is not only its book block. A Japanese edition ships with a
-- 帯 (obi) — the paper band around the cover, usually the first thing
-- thrown away — a dust jacket, and sometimes a 函 (slipcase) for a box
-- or a special edition. Collectors track them separately because they
-- decide what a copy is worth and whether it is "complete": the guide
-- every second-hand seller follows grades the obi apart from the book.
--
-- Three booleans rather than a free-text field: the question is always
-- the same three, and a checkbox is answerable in a second where a text
-- box is not.
--
-- Default FALSE, which is the honest state for every existing row: we
-- do not know, and pretending a copy has its obi would inflate a shelf
-- nobody checked.
ALTER TABLE user_volumes
    ADD COLUMN IF NOT EXISTS has_obi BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_jacket BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_slipcase BOOLEAN NOT NULL DEFAULT FALSE;
