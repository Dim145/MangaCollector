# MangaCollector — Claude Code Guide

## Project Overview

Full-stack web app for tracking manga collections. React frontend + Express backend + PostgreSQL + MinIO (S3) for file storage.

## Architecture

```
client/   → React 19 + Vite + Tailwind CSS
server/   → Express 5 + Knex + Objection.js ORM + Passport.js
```

**Backend pattern:** MVC — routes → controllers → services → models
**Auth:** Passport.js with Google OAuth 2.0 or generic OpenID Connect (configurable via `AUTH_MODE` env var)
**Database:** PostgreSQL via Knex query builder + Objection ORM
**File storage:** MinIO (S3-compatible)
**Dev proxy:** Traefik v2.10

## Key Environment Variables (server/.env)

```
NODE_ENV, PORT
AUTH_MODE=google|openidconnect
AUTH_CLIENT_ID, AUTH_CLIENT_SECRET
SESSION_SECRET
FRONTEND_URL
POSTGRES_URL
S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET
MAX_BODY_SIZE_MB  # optional, default 10, clamp [1,1024]
```

## Running the Project

```bash
# Full stack (recommended)
docker-compose up

# Client dev server only — Vite on port 5173
cd client
nvm use            # picks Node 24 from client/.nvmrc
pnpm run dev

# Server dev only
cd server && cargo run --bin manga-collector-server
```

## Package manager: pnpm

The client uses **pnpm** (not npm) — pinned via `packageManager` in
`client/package.json` and activated through corepack. Three reasons:

1. **Disk** — content-addressable global store hard-links shared deps
   across worktrees (this repo has several under `.claude/worktrees/`),
   saving ~1 GB+ vs duplicated `node_modules`.
2. **Speed** — install ~5 s vs ~15 s with npm; build ~385 ms vs ~795 ms.
3. **Strict dep resolution** — only declared deps are importable, no
   phantom transitive accidents.

First-time setup on a new machine:
```bash
nvm use 24         # required Node version
corepack enable    # ships with Node, activates pnpm
cd client && pnpm install
```

## Building

```bash
cd client && pnpm run build   # Outputs to client/dist/
docker-compose build          # Build all Docker images
```

## Testing

No test framework is currently configured.

## Code Style

- Frontend: ESLint + Prettier (configured via `eslint.config.js`)
- Backend: Prettier
- Editor: `.editorconfig` defines indentation/formatting rules
- Tailwind CSS utility-first styling; use `tailwind-merge` (twMerge) for conditional classes

## API Routes

| Prefix | Purpose |
|--------|---------|
| `/auth` | OAuth callbacks & session management |
| `/api/library` | Manga library CRUD |
| `/api/volumes` | Volume tracking |
| `/api/user` | User profile |
| `/api/settings` | User preferences |
| `/api/storage` | File uploads |
| `/api/health` | Health checks |

## Database

- Migrations in `server/db/migrations/`
- Run migrations: `node server/migrate.js`
- Models: `User`, `UserLibrary`, `UserVolume`, `Setting`

## Frontend Components (`client/src/components/`)

~20 components including Dashboard, Library, Volumes, Profile, Settings views. Global state via React Context (`SettingsContext`). Routing via React Router DOM.

## Docker / Infrastructure

- `docker-compose.yml` — dev setup with Traefik, PostgreSQL, MinIO
- `docker-compose.prod.yml` — simplified prod setup (backend + client only)
- Frontend served by Nginx (Alpine) in production
- Backend runs on Node 20 Alpine
- Traefik dashboard: `http://localhost:8080`

## External Integrations

- MyAnimeList (MAL) API — manga metadata (falls back to mock data on error)
- Google OAuth / generic OIDC — authentication
