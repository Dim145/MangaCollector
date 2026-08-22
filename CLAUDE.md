# MangaCollector — Claude Code Guide

## Project Overview

Full-stack web app and offline-first PWA for tracking manga collections
volume by volume. React 19 frontend + **Rust/Axum** backend + PostgreSQL,
with optional Redis cache and S3/MinIO object storage.

## Architecture

```
client/   → React 19 + Vite 8 (Rolldown) + Tailwind CSS v4
server/   → Rust 2024 + Axum 0.8 + SeaORM 1.1 (over sqlx 0.8)
```

**Backend pattern:** `routes/` → `handlers/` → `services/` → `models/`
(SeaORM entities). 22 handler modules, 29 service modules, 14 entity modules.

**Auth:** `openidconnect` 4 — Google OAuth 2.0 or generic OpenID Connect,
selected by `AUTH_MODE`. Sessions are PostgreSQL-backed via `tower-sessions`
+ `tower-sessions-sqlx-store`. The `AuthenticatedUser` extractor in
`server/src/auth.rs` is the authz gate on protected routes.

**Database:** PostgreSQL. SeaORM for all business logic; a raw sqlx pool is
kept alongside it purely for the session store and for migrations.

**File storage:** `aws-sdk-s3` (MinIO / S3-compatible), with a local
filesystem fallback when `STORAGE_DIR` is set instead.

**Realtime:** Axum WebSocket at `/api/ws` — per-user broadcast that pushes
cache invalidations for cross-device sync.

**Rate limiting:** `tower_governor`, controlled by the `RATE_LIMIT_*` vars.

**Dev proxy:** Traefik v2.

> The backend was originally Express + Knex + Objection + Passport. That
> stack was fully replaced by the Rust port; no JavaScript backend remains.
> See `docs/TIMELINE.md`, Step 4 "Architectural reset".

## Key Environment Variables (`server/.env`)

`server/.env.example` carries the common subset. Full set read by the code:

| Variable | Purpose |
|---|---|
| `PORT` | HTTP listen port (default 3000) |
| `POSTGRES_URL` | Database DSN |
| `AUTH_MODE` | `google` or `openidconnect` |
| `AUTH_CLIENT_ID` / `AUTH_CLIENT_SECRET` | OAuth credentials |
| `AUTH_ISSUER` | OIDC issuer URL (generic mode) |
| `AUTH_NAME` / `AUTH_ICON` | Login-page display name and icon |
| `SESSION_SECRET` | Session cookie signing key |
| `FRONTEND_URL` | CORS origin + OAuth redirect URI |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_REGION`, `S3_USE_SSL`, `S3_USE_PATH_STYLE` | S3/MinIO storage backend |
| `STORAGE_DIR` | Local-filesystem storage backend instead of S3 |
| `REDIS_URL` | Optional response cache; unset = cache-less |
| `CACHE_PREFIX` | Key prefix for the Redis cache |
| `RATE_LIMIT_ENABLED`, `RATE_LIMIT_PERIOD_SECONDS`, `RATE_LIMIT_BURST_SIZE` | `tower_governor` tuning |
| `MAX_BODY_SIZE_MB` | Optional, default 10, clamped to [1, 1024] |
| `X_FRAME_OPTIONS` | Frame-ancestors header value |
| `APP_UNSECURE_HEALTHCHECK` | `true` allows non-loopback `/api/health` |
| `APP_ENABLE_DOTENV` | Whether to load `.env` at startup |
| `EXTERNAL_PROXY_URL`, `EXTERNAL_PROXY_TIMEOUT_SECS` | Release-calendar proxy (see `docs/release-calendar-proxy.md`) |
| `GOOGLE_BOOKS_API_KEY` | Optional, for ISBN lookups |

Never commit real values — `docker-compose.yml` is tracked.

## Running the Project

```bash
# Full stack (recommended) — Traefik on :12000, dashboard on :8080
docker compose up

# Client dev server only — Vite on :5173
cd client
nvm use            # Node 24 from client/.nvmrc
pnpm install
pnpm run dev

# Server dev only — Axum on :3000
cd server && cargo run
```

## Package manager: pnpm

The client uses **pnpm**, not npm — pinned via `packageManager` in
`client/package.json` and activated through corepack. Reasons: a
content-addressable store that hard-links shared deps across worktrees,
faster installs and builds, and strict dep resolution (no phantom
transitives).

First-time setup:
```bash
nvm use 24
corepack enable
cd client && pnpm install
```

`client/package.json` also carries a `pnpm.overrides` block pinning
security-patched transitive versions. Leave those in place unless the
advisory they address is resolved upstream — each entry corresponds to a
real GHSA.

## Building

```bash
cd client && pnpm run build      # → client/dist/
cd server && cargo build --release
docker compose build
```

## Testing

- **Server:** `cargo test` — 34 tests across 8 `#[cfg(test)]` modules
  (`storage.rs`, `util/{url,uuid,image}.rs`,
  `services/{genres,proxy_client,google_books_api,activity_coalescer}.rs`).
- **Client:** no test framework configured.

## Code Style

- Frontend: ESLint 10 + Prettier 3 (`client/eslint.config.js`). Currently
  clean — 0 errors, 0 warnings across 209 files. Keep it that way.
- Backend: `cargo fmt` + `cargo clippy`. Currently clippy-clean; the one
  `#[allow(clippy::too_many_arguments)]` in `services/library.rs` is
  deliberate and documented at the call site.
- `.editorconfig` defines indentation.
- Tailwind utility-first; conditional classes assembled inline via template
  strings or ternaries — no `clsx` / `twMerge`.

## API Routes

Mounted in `server/src/main.rs` as `/auth` and `/api`.

| Prefix | Purpose |
|---|---|
| `/auth` | OAuth callbacks & session lifecycle |
| `/api/library` | Manga library CRUD |
| `/api/volume` | Volume tracking, bulk marks, upcoming volumes |
| `/api/authors` | Author records, photos, refresh |
| `/api/user`, `/api/account` | Profile, deletion, public slug |
| `/api/settings` | User preferences |
| `/api/seals` | Milestone trophies |
| `/api/activity`, `/api/streak` | Activity feed & streak |
| `/api/follows` | Friends / following & feed |
| `/api/sessions` | Active device sessions |
| `/api/import` | External CSV / JSON import |
| `/api/health` | Health checks (loopback-gated by default) |
| `/api/ws` | WebSocket for cross-device invalidation |
| `/api/public-config`, `/api/public-slug`, `/api/public-adult` | Public config & profile visibility |
| `/public/u/{slug}` | Anonymous public profile + poster endpoint |

## Database

- Migrations: **`server/migrations/`** — 44 raw `.sql` files, embedded at
  compile time via `sqlx::migrate!("./migrations")` in `server/src/db.rs`
  and applied automatically on startup. There is no separate migrate script.
- Entities (`server/src/models/`): `activity`, `archive`, `author`,
  `coffret`, `compare`, `follow`, `library`, `session_meta`, `setting`,
  `snapshot`, `user`, `user_seal`, `volume`.
- Custom (non-MAL) series use a **negative `mal_id`**, allocated from a
  sequence to stay race-free.

## Frontend (`client/src/`)

112 components in `components/`, 50 hooks in `hooks/`, plus `lib/`
(Dexie `db.js`, outbox `sync.js`, `connectivity.js`, `theme.js`,
`barcode.js`), `i18n/` (en/fr/es, lazy-loaded per language) and `styles/`.

Server state via TanStack Query 5 with WebSocket-driven invalidation;
local cache in Dexie (IndexedDB) with an offline outbox that replays
chronologically on reconnect. Routing via React Router 7.

## Docker / Infrastructure

- `docker-compose.yml` — dev stack: Traefik, PostgreSQL 15, Redis 8,
  server, client.
- `docker-compose.prod.yml` — prod: server + client only.
- Backend image: multi-stage `rust:alpine` → static musl binary in
  `FROM scratch`, running as `USER 65532:65532`.
- Frontend image: `node:24-alpine` build → `nginx:alpine`. The nginx master
  intentionally stays root to bind :80 and drops its workers to `nginx`.
- Both run read-only with `cap_drop: ALL` and `no-new-privileges`.
- CI: `.github/workflows/docker-images.yaml.yml` builds and pushes both
  images on GitHub **release publish**. Actions are pinned to commit SHAs —
  keep new ones pinned too.

## External Integrations

- **MyAnimeList** (via Jikan) — primary metadata source
- **MangaDex** — fallback search and enrichment
- **Google Books** — ISBN lookups for the barcode scanner
- **Release-calendar proxy** — optional, see `docs/release-calendar-proxy.md`
- **Google OAuth / generic OIDC** — authentication
- **Sentry / Bugsink** — optional, mutually exclusive error tracking
- **Umami** — optional frontend analytics, templated in at container start
