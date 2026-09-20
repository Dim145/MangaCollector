-- 数 · Repair every drifted `volumes_owned` counter, once.
--
-- `user_libraries.volumes_owned` is denormalised, and until now nothing
-- on the server maintained it: the *client* re-counted the rows after a
-- write on the series page and pushed the total back. Every other way a
-- tome changes hands left the counter untouched — the scanner, the
-- stock-taking count, an archive restore, an external import, an agent
-- on /mcp, or an outbox replayed by a tab that closed before it could
-- push.
--
-- The drift is not cosmetic: the dashboard decides 完 complete and 願
-- wishlist from this column, and `handlers::public` hides a series from
-- a public profile when it reads zero — so a shelf collected entirely
-- through the scanner could be shown to visitors as a wishlist entry.
--
-- `services::ops::volume::update_volume` now re-derives the count on
-- every ownership flip, which keeps it true from here on. This
-- statement fixes the rows that drifted before that existed.
--
-- The clamp to `volumes` mirrors `update_volumes_owned`: the persisted
-- count is always within [0, volumes], so no dashboard ever renders
-- "12/8 volumes". A series whose declared total is 0 (a custom entry
-- with no published count) keeps a plain count.
UPDATE user_libraries AS l
SET    volumes_owned = LEAST(c.owned, GREATEST(l.volumes, 0)),
       modified_on   = modified_on
FROM (
    SELECT user_id,
           mal_id,
           COUNT(*)::int AS owned
    FROM   user_volumes
    WHERE  owned
      AND  mal_id IS NOT NULL
    GROUP  BY user_id, mal_id
) AS c
WHERE l.user_id = c.user_id
  AND l.mal_id  = c.mal_id
  AND l.volumes_owned IS DISTINCT FROM LEAST(c.owned, GREATEST(l.volumes, 0));

-- A series whose volume rows are all un-owned has no row in the
-- aggregate above, so the correlated form catches the counters that
-- should have gone back to zero.
UPDATE user_libraries AS l
SET    volumes_owned = 0,
       modified_on   = modified_on
WHERE  l.volumes_owned <> 0
  AND  NOT EXISTS (
           SELECT 1
           FROM   user_volumes v
           WHERE  v.user_id = l.user_id
             AND  v.mal_id  = l.mal_id
             AND  v.owned
       );
