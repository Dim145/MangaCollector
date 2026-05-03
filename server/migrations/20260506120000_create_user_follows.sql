-- 友 Tomo · Friends feed.
--
-- A user_follows row is a one-way relationship: follower_id is
-- saying "I want to see following_id's activity". Mutuality isn't
-- enforced — the user model is "subscribe to public profiles",
-- closer to RSS than to bidirectional friendship.
--
-- Privacy: The service layer enforces that following_id must be a
-- user with a `public_slug` set (i.e. they have a public profile).
-- The schema doesn't carry that constraint because the public_slug
-- can be unset/reset over time; we want existing follows to survive
-- a temporary public→private flip rather than cascade-delete.
-- The feed endpoint filters at read time on the same predicate.
--
-- The CHECK prevents self-follow (a "subscribe to my own activity"
-- row would be useless and pollute the listing).
--
-- ON DELETE CASCADE on both sides: removing a user wipes all their
-- inbound and outbound follows automatically.

CREATE TABLE IF NOT EXISTS user_follows (
    follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

-- Reverse-direction lookup: "who follows me" — used by future
-- "you have N followers" UX, and by the privacy gate when a user
-- toggles their profile private (we revisit follower visibility).
CREATE INDEX IF NOT EXISTS idx_user_follows_following
    ON user_follows (following_id);
