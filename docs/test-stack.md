# Local test stack

A complete, disposable stack for developing and manually testing the
app with realistic data — including logging in — without any real
identity provider, S3 bucket or credentials.

```
 browser ──► Vite :5173 ──proxy /api /auth /public──► cargo run :3000 ──► Postgres :54329 (docker)
                                                          │
                                                          └──► mock OIDC :8484 (docker)
```

## Start

```bash
# 1. the two containers (Postgres on a non-default port, mock OpenID Connect)
docker compose -f docker-compose.test-stack.yml up -d

# 2. the server, natively, with the stack's env (migrations run at boot)
cd server && set -a && . ./test-stack.env && set +a && mkdir -p .test-stack-storage && cargo run

# 3. the client, with the dev proxy pointed at the server
cd client && VITE_API_PROXY=http://localhost:3000 pnpm dev
```

Open <http://localhost:5173>, click *Get started*: the mock provider
shows a login form that accepts **any username** — there is no password.
The app then behaves exactly as it does behind Google or a real OIDC
provider, because it *is* the real flow (PKCE, nonce, id-token
verification, session cookie); only the issuer is fake.

`VITE_API_PROXY` is the one switch that changes the client: unset, the
Vite config is byte-for-byte what it was, so nothing changes for the
Docker/Traefik setup in `docker-compose.yml`.

## Seed

```bash
node scripts/seed-test-stack.mjs          # ~35 well-known series, ownership spread
node scripts/seed-test-stack.mjs --big    # + MangaDex's top 100: crosses the
                                          #   Dashboard's 100-series virtualization
                                          #   threshold (add --only-big to skip the
                                          #   core set when it is already seeded)
```

The script logs in through the same OAuth flow headlessly, looks each
title up on Jikan (paced under its public rate limit), and creates rows
through the app's own API — `POST /api/user/library`, `PATCH
/api/user/volume`, `PATCH /api/user/library/{mal_id}/{owned}` — so the
data went through every validation the UI's Add page goes through.
One Piece is pinned to 110 volumes (MAL reports `null` for ongoing
series) so the volumes grid's virtualization path has a real 100+ tome
series to run against. Re-running is safe: the server updates a series that is already there.

Three things about the upstreams worth knowing: Jikan answers 200 for ids
its edge has cached and 504 for cold ones whenever MAL is slow upstream,
so each core title falls back to MangaDex (by title, relevance-ordered)
when its MAL lookup fails; Jikan's edge also returns 504
to any request that advertises compressed encodings — `fetch`'s default
— so the script talks to it through `node:https` with minimal headers;
and its `/top/manga` and `?q=` search endpoints are unreliable, so
`--big` takes MangaDex's most-followed list through the app's own
MangaDex add path instead (the mixed MAL + MangaDex library real users
end up with).

## Verify the archive round-trip

```bash
node scripts/verify-archive-roundtrip.mjs
```

Exercises `GET /api/user/export.json` → `POST /api/user/import` with
real data instead of unit fixtures. The script first *enriches* the
seeded library with every field the v1 bundle used to drop (publisher,
edition, review, author, three loans with notes, a hand-pencilled
upcoming volume, a box set), then runs two scenarios and diffs
normalised API snapshots of both sides:

- **fresh account, `mode: "merge"`** — import into a brand-new user and
  expect the two libraries to read back identically;
- **same account, `mode: "replace"`** — damage the original (clear
  fields, return a loan, delete a coffret), re-import the bundle over
  it and expect the damage undone.

It also drives the derived reading progression end to end (bulk-read a
small series → `completed` with dates, `POST …/reread` → one more lap,
every tome unread again) and sets the progression by hand on another
series, so the bundle has to carry those fields too.
Any field that comes back different is listed by series/volume and the
process exits 1. Re-running is safe: the enrichment tolerates what a
previous run already created, and each run restores into a new
throwaway `restore-check-*` user (the mock accepts any username).
`scripts/lib/stack-client.mjs` is the headless login + cookie-jar
helper both scripts share; reuse it for further stack checks.

## Verify the MyAnimeList XML import

```bash
node scripts/verify-mal-xml-import.mjs
```

Posts the XML MyAnimeList exports (Profile → Export → Manga list) to
`POST /api/user/import/external/mal-xml` as a throwaway `xml-check-*`
user and checks the mapping through the API: retail (bought) volumes
win over read volumes, an unknown total still tracks the owned run,
"Completed" owns the whole run, "Plan to Read" is a wishlist entry,
CDATA / entity titles and comments come through, id-less entries are
skipped and junk input is a 400. Then commits the previewed bundle and
reads the library and volume rows back. The browser side (unpacking
the `.xml.gz` with `DecompressionStream`) is covered by
`client/src/lib/importFile.test.js`.

## Reset

```bash
docker compose -f docker-compose.test-stack.yml down -v   # drops the database
rm -rf server/.test-stack-storage
```

## What is (deliberately) not real

Everything in `server/test-stack.env` and `docker-compose.test-stack.yml`
is a localhost mock: the OIDC client id/secret are accepted by the mock
whatever their value, the `SESSION_SECRET` is a fixed placeholder so
sessions survive a server restart while iterating, rate limiting is off
so the seed can run, and the session cookie is `Secure=false` because
the frontend is plain http. None of it is reachable from outside the
machine and none of it may be reused anywhere else.
