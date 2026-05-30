-- 番 · Race-free negative-id allocators for custom (user-authored)
-- authors and library entries.
--
-- The old scheme probed `MIN(mal_id) - 1` per user, then INSERTed. Under
-- READ COMMITTED two simultaneous mints for the same user computed the
-- SAME id; the loser hit a unique violation (23505) — which, now that
-- constraint violations map to 409, made the client drop the whole edit
-- instead of retrying it to success. `nextval` is non-transactional and
-- concurrency-safe: every caller gets a distinct value even before
-- commit, so the collision can't happen. A value wasted on a rolled-back
-- transaction is a harmless gap in the (vast) negative namespace.
--
-- Each sequence is negative + decrementing, and is SEEDED BELOW the
-- current global minimum of its table so no value it issues can ever
-- collide with an id the old MIN-1 scheme already handed out in ANY
-- user's namespace (a global value strictly more negative than every
-- existing row is unique per-user a fortiori).

-- ── Custom authors (authors.mal_id where user_id IS NOT NULL) ──────────
CREATE SEQUENCE IF NOT EXISTS custom_author_id_seq
    AS integer INCREMENT BY -1 MINVALUE -2147483648 MAXVALUE -1
    START WITH -1 NO CYCLE;

-- setval to the current global min (is_called = true) ⇒ the next nextval
-- returns min - 1. The HAVING clause makes this a no-op (zero rows, so
-- setval is never evaluated) when there are no custom authors yet, in
-- which case the sequence keeps its START WITH -1 and first issues -1.
SELECT setval('custom_author_id_seq', MIN(mal_id), true)
FROM authors
WHERE user_id IS NOT NULL AND mal_id IS NOT NULL
HAVING MIN(mal_id) IS NOT NULL;

-- ── Custom library entries (user_libraries.mal_id < 0) ────────────────
CREATE SEQUENCE IF NOT EXISTS custom_library_id_seq
    AS integer INCREMENT BY -1 MINVALUE -2147483648 MAXVALUE -1
    START WITH -1 NO CYCLE;

SELECT setval('custom_library_id_seq', MIN(mal_id), true)
FROM user_libraries
WHERE mal_id IS NOT NULL AND mal_id < 0
HAVING MIN(mal_id) IS NOT NULL;
