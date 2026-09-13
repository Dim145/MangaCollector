-- 物 · The physical copy itself.
--
-- A collector's shelf holds more than "owned": the state the copy is
-- in, where it lives, whether it is one of several (doubles bought by
-- mistake or on purpose), and when it was bought. Four nullable /
-- defaulted columns on the volume row; nothing else changes.
ALTER TABLE user_volumes
    ADD COLUMN IF NOT EXISTS condition TEXT NULL,
    ADD COLUMN IF NOT EXISTS location TEXT NULL,
    ADD COLUMN IF NOT EXISTS extra_copies INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bought_at DATE NULL;

ALTER TABLE user_volumes
    DROP CONSTRAINT IF EXISTS user_volumes_condition_check;
ALTER TABLE user_volumes
    ADD CONSTRAINT user_volumes_condition_check
    CHECK (condition IS NULL OR condition IN ('new', 'like_new', 'good', 'fair', 'poor'));

ALTER TABLE user_volumes
    DROP CONSTRAINT IF EXISTS user_volumes_extra_copies_check;
ALTER TABLE user_volumes
    ADD CONSTRAINT user_volumes_extra_copies_check CHECK (extra_copies >= 0);
