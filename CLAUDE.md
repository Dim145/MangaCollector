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
(SeaORM entities). 23 handler modules, 31 service modules, 16 entity modules.

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
| `SESSION_SECRET` | **Inert.** Read into the config and used nowhere — session ids come from the Postgres store and the cookie is not signed. Startup says so when it is set. |
| `FRONTEND_URL` | CORS origin + OAuth redirect URI |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_REGION`, `S3_USE_SSL`, `S3_USE_PATH_STYLE` | S3/MinIO storage backend |
| `STORAGE_DIR` | Local-filesystem storage backend instead of S3 |
| `REDIS_URL` | Optional response cache; unset = cache-less |
| `CACHE_PREFIX` | Key prefix for the Redis cache |
| `RATE_LIMIT_ENABLED`, `RATE_LIMIT_PERIOD_SECONDS`, `RATE_LIMIT_BURST_SIZE` | `tower_governor` tuning |
| `TRUST_PROXY_HEADERS` | `true` behind a reverse proxy you control, so the rate limiter keys on `X-Forwarded-For` instead of the socket's peer address. Default `false`. Wrong either way is bad: unset behind a proxy, everyone shares one bucket; set without one, the header is forged and the limiter does nothing. |
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

- **Server:** `cargo test` — 106 tests across 24 `#[cfg(test)]` modules
  (`storage.rs`, `errors.rs`, `util/{url,uuid,image,isbn}.rs`,
  `services/{genres,proxy_client,google_books_api,isbn_resolver,activity_coalescer,realtime,archive,external_import,library,cover_pool,loan_history,locations,users}.rs`,
  `handlers/realtime.rs`, `models/{archive,library,volume}.rs`).
  `services/users.rs` pins `row_publicly_visible` — the one predicate
  every cross-user surface asks before showing a row (adult opt-out AND
  the Birthday-mode wishlist horizon, independently); `archive.rs` also
  pins the import ceilings and the ledger index.
  `services/cover_pool.rs` pins the cover-URL allowlist (host match,
  `http`→`https`, no credentials, own posters pass); `loan_history.rs`
  the loans CSV (statuses, BOM, date bounds); `locations.rs` the note
  hygiene. `util/isbn.rs`
  pins ISBN normalisation (10 → 13, checksums); `services/isbn_resolver.rs`
  pins the four catalogue parsers on real fixtures (Google Books, Open
  Library, BnF SRU Dublin Core, openBD) and the cache freshness rule
  (a hit lives 30 days, a miss 1 day). `services/library.rs`
  pins the reading-progression rule (`next_reading_state`): what a series'
  status and dates become as tomes are marked read or unread. The archive ones pin the
  bundle wire format (v1 still imports) and the series-identity rule the
  importer matches conflicts with (MAL id → MangaDex UUID → title).
- **Client:** `pnpm test` (Vitest 5 + jsdom) — 1 012 tests across 48 suites
  covering the logic layer. `pnpm run test:coverage` writes an HTML/lcov
  report to `client/coverage/`; scope is `src/utils/**` + `src/lib/**`
  (~41% statements), and untested modules there show as 0% on purpose so
  the remaining gaps stay visible.
  - `utils/`: `date`, `price`, `volume`, `library`, `libraryStats`,
    `user`, `auth` (~76% overall).
  - `lib/`: `isbn`, `season`, `queryState`, `share`, `pasteDetect`,
    `coverPalette`, `sealsCatalog`, `accent`, `theme`, `tour`,
    `deepLinks`, `scrollLock`, `haptics`, `connectivity`, `dailyTexts`,
    `scanLookup` (a scanned barcode against the cached shelf),
    `loanHistory` and `navCounters` (pure read-side helpers),
    `locations` (grouping tomes by place, move payloads), `inventory`
    (the stock-taking state machine), `labels` (Avery sheet geometry,
    EAN-13 checksums, label text fitting), `gridDensity` (the two grid
    shapes — a test parses the Tailwind class string against the lane
    table so the plain and windowed paths cannot drift), `markdown` (the
    help pages' reader) and `barcode` (what a camera says it can do).
    `lib/isbnResolve.test.js` pins the lookup order — Dexie cache, then
    the server's resolver, then the browser's own direct fallback only
    when the server is unreachable.
  - `lib/sync/`: `events`, and `outbox` — the offline queue runs against
    a real in-memory IndexedDB (`fake-indexeddb`), so coalescing and the
    delete cascade are exercised rather than mocked, and a second block
    covers what actually *leaves* the device on a flush. `lib/db.test.js`
    covers the outbox-aware cache writers the same way; `lib/owner.js`
    (which account the local caches belong to) pins the asymmetry that
    matters — a foreign stamp wipes, an absent one adopts; `clientId` and
    `realtimePlan` (the websocket decision table) are pure and tested.
  - `components/ui/CoverImage.test.jsx`, `components/VirtualVolumeGrid.test.jsx`
    and `components/ArchiveSection.test.jsx` (the import modal's merge /
    replace choice) are the component tests; `hooks/useWindowGridVirtualizer.test.js`
    covers the lane / pinned-row maths shared by both windowed grids and
    `hooks/useArchive.test.jsx` pins the import endpoint's wire shape.
  - Three suites assert **cross-language parity** by parsing the Rust
    source: the seal catalogue against `services/seals.rs::CATALOG`, the
    accent list against `services/settings.rs::VALID_ACCENT_COLORS`, and
    the accent list against the `[data-accent]` blocks in the stylesheet.
    They self-skip when the file is absent, so a client-only checkout
    still runs green.
  - Config: `client/vitest.config.js` (separate from `vite.config.js` so
    the PWA plugin stays out of the test run); `src/test/setup.js` pins
    `TZ=UTC` and clears web storage between cases.
  - Not covered yet: the other 111 components, the 50 hooks, and the
    canvas/Web-Audio modules (`shelfSnapshot`, `sounds`, `barcode`).
- **Formatting caveat:** neither tree is clean under its formatter — a
  blind `cargo fmt` reflows ~54 Rust files, and `prettier --write .`
  rewrites 199 of 209 client files (including `lib/season.js`, whose
  hand-aligned astronomical coefficients it would make worse). Format
  only the hunks you touch: `python3 scripts/rustfmt-touched.py
  server/src/<file>.rs …` applies rustfmt's layout to the lines changed
  since HEAD (±2) and nothing else. CI runs the same script with
  `RUSTFMT_TOUCHED_BASE`. It refuses to write a file when rustfmt's
  re-sorting of the `use` block would drop an import out of the touched
  hunks — if it says so, reformat the import block by hand.
- **Mutation testing:** `node scripts/stryker-module.mjs <lib/foo>` runs a
  Stryker campaign over one module against its own test file (a minute);
  `--all` sweeps every paired module; `pnpm test:mutants` mutates the
  whole logic layer against the whole suite (slow, deliberate). The
  official Vitest runner is unusable — it `JSON.stringify`s Vitest 5's
  resolved config, which is circular — so `client/stryker.conf.json`
  uses the generic command runner and pays for it by rerunning the
  command for every mutant. The logic layer sits around 80%; a module
  under 70% usually means its tests assert an answer that an inverted
  condition would also produce.
- **Contrast:** `node scripts/contrast-audit.mjs` reads the palette out of
  `client/src/styles/index.css` (base, light override, every
  `[data-accent]` block), walks the JSX for the colour utilities actually
  used, and exits non-zero on any text pair under 4.5:1. Currently 0
  failures. Watermark kanji under 50 % opacity are listed apart, not
  counted. Run it after touching the palette or adding a `text-…` /
  `bg-…` pair.

## Local test stack

`docs/test-stack.md` — Postgres + a mock OpenID Connect provider in Docker
(`docker-compose.test-stack.yml`), the server run natively with
`server/test-stack.env`, the client with `VITE_API_PROXY=http://localhost:3000`.
Log in with any username. `node scripts/seed-test-stack.mjs [--big]` fills the
library from MyAnimeList (Jikan) with a MangaDex fallback, including a
110-volume One Piece for the virtualized volumes grid.
`node scripts/verify-archive-roundtrip.mjs` then proves export → import is
lossless against that library (fresh-account merge and same-account replace),
and fails on any dropped field or duplicated series. It also compares the
loan ledger and the places registry row by row, and checks ISBN
normalisation on real input. Run it whenever a column is added to the
library, volume or coffret tables — the bundle must carry it.

These scripts create accounts and, in the round-trip verifier's case,
damage data on purpose to prove the backup restores it. They refuse to
run against anything but localhost; a deliberate `SEED_ALLOW_REMOTE=1`
is the only way past that, per run.

## Module guides

`docs/modules/` explains one subsystem per file — mental model, data,
flows as Mermaid diagrams, endpoints, client side, invariants, where the
code lives, how it is tested: `archive.md` (export / import / restore),
`loans.md` (loans, borrowing, the ledger), `locations.md` (the places
registry), `realtime.md` (WebSocket + Dexie + the outbox), `releases.md`
(upcoming volumes and the calendar), `scan.md` (barcodes, ISBN
resolution, inventory, labels). Read the relevant one before changing a
subsystem; they are written against the code, not the intent.

## Code Style

- Frontend: ESLint 10 + Prettier 3 (`client/eslint.config.js`). Currently
  clean — 0 errors, 0 warnings across 285 files. Keep it that way.
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
| `/api/library` | Manga library CRUD, reading progression (`reading_status`, dates, `times_read`; `POST /{mal_id}/reread`) |
| `/api/volume` | Volume tracking, bulk marks, upcoming volumes, loans (`/loans`, `/loans/borrowed`, append-only ledger at `/loans/history`, spreadsheet at `/loans/export.csv?from&to`), physical copy (condition, location, extra copies, bought on, `isbn`) |
| `/api/authors` | Author records, photos, refresh |
| `/api/user`, `/api/account` | Profile, deletion, public slug; `GET /api/user/isbn/{isbn}` resolves a barcode through the server-side chain (see External Integrations) |
| `/api/user/locations` | The places registry — list with per-place counts, create, rename (cascades to the tomes filed there), annotate, reorder, delete (unfiles them) |
| `/api/settings` | User preferences |
| `/api/seals` | Milestone trophies |
| `/api/activity`, `/api/streak` | Activity feed & streak |
| `/api/follows` | Friends / following & feed |
| `/api/sessions` | Active device sessions |
| `/api/import` | External imports: MAL by username (Jikan) or official XML export, AniList, MangaDex list, Yamtrack CSV |
| `/api/health` | Health checks (loopback-gated by default) |
| `/api/ws` | WebSocket for cross-device invalidation |
| `/api/public-config`, `/api/public-slug`, `/api/public-adult` | Public config & profile visibility |
| `/public/u/{slug}` | Anonymous public profile + poster endpoint |

## Database

- Migrations: **`server/migrations/`** — 50 raw `.sql` files, embedded at
  compile time via `sqlx::migrate!("./migrations")` in `server/src/db.rs`
  and applied automatically on startup. There is no separate migrate script.
- Entities (`server/src/models/`): `activity`, `archive`, `author`,
  `coffret`, `compare`, `follow`, `isbn_cache`, `library`, `loan_history`,
  `location`, `session_meta`, `setting`, `snapshot`, `user`, `user_seal`,
  `volume`.
- `locations` is a **registry, not a foreign key**: a tome keeps naming
  its place in `user_volumes.location` (what the offline cache and the
  archive carry), and the table adds the note, the order and the identity
  that let a place be renamed or emptied in one move. A place typed on a
  tome registers itself; a rename rewrites the tomes filed under it;
  deleting one unfiles them.
- `loan_history` is an **append-only ledger**: a row per lend, closed by
  `returned_at` when the tome comes back (or is un-owned), never deleted
  with the volume (`volume_id` goes `NULL`). It travels in the archive
  bundle and is what "already lent N times" and the borrower suggestions
  read from.
- Custom (non-MAL) series use a **negative `mal_id`**, allocated from a
  sequence to stay race-free.

## Frontend (`client/src/`)

122 components in `components/`, 54 hooks in `hooks/`, plus `lib/`
(Dexie `db.js`, outbox `sync.js`, `connectivity.js`, `theme.js`,
`barcode.js`, `isbn.js`, `scanLookup.js`, `locations.js`, `inventory.js`,
`labels.js`), `i18n/` (en/fr/es, lazy-loaded per language) and `styles/`.
The barcode scanner is fully client-side (`/scan` finds a tome on the
shelf, adds a double, or hands the ISBN to the add flow); only the
catalogue lookup needs a network. `/rangement` is the places view (move
tomes by selection or by scanning into a place), `/inventaire` the
stock-taking count, and both the series page and a place can print an
Avery label sheet with each tome's EAN-13 (jsPDF + JsBarcode, lazy).
The barcode scanner also reads a still photo (the way in when the camera
is refused or absent) and offers torch and zoom when the device reports
them. `/aide` is the help page: its prose lives in
`client/src/content/help.{en,fr,es}.md` and is fetched with the page, not
bundled — a small in-house reader parses it to plain objects that the
renderer turns into React nodes, so nothing is ever set as HTML.

Server state via TanStack Query 5 with WebSocket-driven invalidation;
local cache in Dexie (IndexedDB) with an offline outbox that replays
chronologically on reconnect. Routing via React Router 7.

## Docker / Infrastructure

- `docker-compose.yml` — dev stack: Traefik, PostgreSQL 15, Redis 8,
  server, client. Traefik on `:12000` is the way in; the dashboard
  (`:8080`) and the direct server/client mappings are bound to loopback.
  `AUTH_CLIENT_SECRET` and the other real secrets come from the
  environment — compose refuses to start without them.
- `docker-compose.prod.yml` — prod: server + client only.
- Backend image: multi-stage `rust:alpine` → static musl binary in
  `FROM scratch`, running as `USER 65532:65532`.
- Frontend image: `node:24-alpine` build → `nginx:alpine`. The nginx master
  intentionally stays root to bind :80 and drops its workers to `nginx`.
- Both run read-only with `cap_drop: ALL` and `no-new-privileges`.
- CI: `.github/workflows/ci.yml` runs the gates on every push and PR —
  client (install `--frozen-lockfile`, lint, tests, build), server
  (rustfmt on touched lines, clippy `-D warnings`, tests) and `cargo
  audit`. `.github/workflows/docker-images.yaml.yml` builds and pushes
  both images on GitHub **release publish**. Actions are pinned to commit
  SHAs — keep new ones pinned too.
  - Neither formatter runs as a blanket check: `cargo fmt --check` fails
    on ~54 files and `prettier --check .` on 199 of 209, one of which
    (`client/src/lib/season.js`) Prettier would make worse. CI checks
    that the lines a commit *touched* are formatted, via
    `RUSTFMT_TOUCHED_BASE=<base> python3 scripts/rustfmt-touched.py`.
- Security scanners, each with its exceptions recorded next to it:
  `semgrep --config=auto .` (`.semgrepignore`), `gitleaks detect`
  (`.gitleaks.toml`), `cargo audit` (`server/.cargo/audit.toml`) and
  `trivy fs .` (`trivy.yaml` + `.trivyignore`). All four are clean; an
  ignore without a written reason is a bug.

## External Integrations

- **MyAnimeList** (via Jikan) — primary metadata source
- **MangaDex** — fallback search and enrichment
- **ISBN resolvers** — `services/isbn_resolver.rs` walks Google Books →
  Open Library → BnF SRU → openBD (7 s each) and stores the outcome in
  `isbn_cache`, hit or miss, so a barcode costs one upstream round per
  month at most. When the server itself is unreachable the browser asks
  Google Books, Open Library and openBD directly (they send CORS headers;
  the BnF does not, so it stays server-only)
- **Release-calendar proxy** — optional, see `docs/release-calendar-proxy.md`
- **Google OAuth / generic OIDC** — authentication
- **Sentry / Bugsink** — optional, mutually exclusive error tracking
- **Umami** — optional frontend analytics, templated in at container start
