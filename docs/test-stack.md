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
