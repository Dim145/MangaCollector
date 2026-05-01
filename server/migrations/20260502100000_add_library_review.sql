-- 記憶 Kioku · Per-series review + public-visibility flag.
--
-- A free-text personal note attached to a library row. Distinct from
-- per-volume `notes` (which is granular pricing/store data) — this is
-- the user's reflection on the series as a whole. When `review_public`
-- is true and the user has a public_slug, the review is surfaced on
-- the public profile under the series cover.
--
-- 5000 chars cap matches the textarea max in the SPA — long enough for
-- a few paragraphs, short enough that a public review can render
-- without pagination on the profile page.

ALTER TABLE user_libraries
    ADD COLUMN review TEXT
        CHECK (review IS NULL OR length(review) <= 5000);

ALTER TABLE user_libraries
    ADD COLUMN review_public BOOLEAN NOT NULL DEFAULT FALSE;
