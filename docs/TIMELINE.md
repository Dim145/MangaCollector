# MangaCollector — Project Timeline

A condensed history of every meaningful change since the project was
forked, walking from the bare-bones URL-cleanup commit through the
v2.9.0 release.

**208 commits across two distinct development phases**:
- **Phase 1 (solo)**: 62 commits laying the auth, storage and metadata
  foundations.
- **Phase 2 (AI-assisted)**: 146 commits — feature explosion, full Rust
  port, full UI redesign, eight version bumps.

---

## Phase 1 — Foundations

Solo development. Stack hardening + initial features.

### Step 1 — Auth & DB rewire
- Stripped hard-coded URL references; first deploy-portable build.
- Added OpenID Connect alongside Google OAuth (`AUTH_MODE` switch).
- Migrated database access from Supabase to a self-hosted Postgres via
  Knex; first migrations checked in (`users`, `user_libraries`,
  `user_volumes`).
- Wired Passport with Knex-backed session storage.

### Step 2 — Genres, settings, MAL sync
- Backend genre column + blur logic for adult content.
- Settings page bootstrapped (display preference, currency, adult-content
  toggle); React Context for app-wide settings.
- `update from MAL` flow + price display; settings persist to DB.

### Step 3 — Posters, custom entries, deploy plumbing
- First version of backend storage (Cloudinary, then local fallback).
- Poster upload / delete UI with refresh button.
- Custom-entry add flow; "already in library" check.
- GitHub workflows + healthchecks, dynamic Google references.
- MAL top-manga fetch on the about page (replacing static mock).

> The project sat dormant for several months between Phase 1 and Phase 2.

---

## Phase 2 — AI-Assisted Development

> 🤖 **From commit [`218e4897`](https://github.com/dim145/MangaCollector/commit/218e4897f6fc2c983336b96a9433966698521f92)
> ("feat: add healthchecks") onward, all subsequent development was
> carried out with assistance from Claude (Anthropic).**

### Step 4 — Architectural reset
The single largest day in the project's history: 29 commits.
- **Backend port**: raw Knex / Passport replaced with **Rust + Axum + SeaORM**.
- **Offline mode**: Dexie cache + outbox pattern, optimistic writes,
  pending-logout queue.
- **Connectivity engine**: axios interceptor + periodic probes feed a
  global "is the server reachable" signal.
- **Barcode scanner** with ISBN lookup, Google Books fallback, multi-volume
  scan-commit flow with gap-fill.
- **Theme system** (dark / light / auto) with synchronous bootstrap to
  prevent palette flash.
- **Language switching** + initial fr/en/es i18n bundles.
- **Activity log** + user activity feed component.
- **Avatar picker** (first version, Jikan-backed) + custom-avatar storage.
- **PWA**: install prompt, iOS instructions, manifest.
- **Performance**: route-level code-splitting, skeleton loaders, page-loader.
- **Logo redesign** (manga-shelf concept).

### Step 5 — Coffrets, collectors, MangaDex (v2.0.x → v2.2.0)
- **Coffret support**: grouped volumes with shared price + collector flag.
- **Collector edition** detection ("all volumes are collector" → gold seal).
- **Profile analytics**: spending chart, reading cadence, composition pies.
- **`StoreAutocomplete`** component (typeahead against the user's known stores).
- **MangaDex integration**: merged search, cover synchronization, custom
  entries can be cross-linked.
- **Redis-backed cache layer** for external API responses.
- Jade → moegi accent rename across the design system.

### Step 6 — Covers, deletion, filtering (v2.4.0)
- **CoverPickerModal** — choose cover from MAL / MangaDex sources.
- **Per-volume covers** with floating preview on hover / long-press.
- **Modal exit animations** (delayed unmount pattern).
- **GDPR-compliant `DeleteAccountFlow`** — three-step modal + email + vow.
- **Tag-based filtering** on the Dashboard with active-chip indicator row.
- **Split-button sync actions** (MAL + MangaDex) with source-aware feedback.
- Connectivity hardening — SPA fallback can no longer mask a backend outage.

### Step 7 — Seals, public profiles, realtime, security
- **Ceremonial seal system**: 31 seals across 9 categories, 5 tiers.
- **Reading status tracking** with read-on date + dynamic kanji heatmap cell.
- **Public profile** at `/u/{slug}` — opt-in, slug validation, adult-content gate.
- **Library compare** — side-by-side view at `/compare/{slug}` with
  copy-from-other-user.
- **Archive import/export** — full library + volumes JSON dump.
- **Realtime sync**: WebSocket-driven cache invalidation across tabs/devices.
- **Seasonal theme selector** — spring / summer / autumn / winter atmospheres.
- **Security hardening**: rate limiting (`tower_governor`), CSRF middleware,
  SameSite=Lax cookies, response security headers.

### Step 8 — Onboarding, glossary, birthday mode (v2.6.x)
- **WelcomeTour** for first-time visitors.
- **Glossary page** (`/glossary`) — public kanji reference, tap-to-copy.
- **Publisher / edition** metadata fields on the manga page.
- **Birthday mode** — time-bounded public exposure of the wishlist.
- **PWA app shortcuts** (launcher menu) + **Web Share Target** integration.
- **Vow-based account deletion** replacing email confirmation.
- **GPU-perf passes** on header / modal / vow components.
- **Switch to Rustls** (drop OpenSSL native dep) + Cargo modernization.
- **In-grid spotlight ceremony** for newly-earned seals (replaces full-screen).

### Step 9 — Calendar, retrospective, sessions
- **Calendar page** with ICS subscription URL (rotatable).
- **Year-in-Review poster** with shareable summary stats.
- **Active sessions modal** ("your devices") with revoke + session-id rotation.
- **Volume notes** (per-volume freeform text, exported in archive).
- **`VolumeDetailDrawer`** replaces inline expansion; consistent edit shell.
- **Volumes view-mode toggle** (ledger / shelf).
- **Lazy-load** for analytics charts and rare modals.
- **Seasonal greeting banner** (astronomically-accurate season detection).
- **Deep-link intent handling** + route-level error boundaries.

### Step 10 — Tooling & build (v2.8.0)
- **pnpm migration** (was npm) — content-addressable store, 3× faster builds.
- **Multi-stage Dockerfile** rewrite for faster rebuilds and smaller images.
- **CI parallelization** (backend / frontend separate jobs, concurrency cap).
- Comment / dead-code cleanup pass across the codebase.

### Step 11 — Polish & UX
- **`AddUpcomingVolumeModal`** — manual entry of announced future tomes.
- **Unified toast messaging** (`notifySyncInfo` / `notifySyncError`) across
  ~10 modals/pages.
- **Kanji watermarks** added to 8 surfaces (AddCoffret, CoverPicker,
  MalRecommendation, MangadexPrefill, InstallPrompt, ComparePage,
  PublicProfile, ShelfStickers).
- **AvatarPicker UX overhaul**: live search, series chip-rail, save-on-click,
  Western-order names ("Rudeus Greyrat" not just "Greyrat"), clean ring
  selection, 印 stamp confirmation.
- **`SessionsModal`** mobile responsive layout fix.
- **Volume corner-badge clipping** fix (`[contain:layout]` only, dropped
  `paint`).
- **About page covers** fix (Jikan response bridge to `<picture>` shape).

### Step 12 — Festival redesign of the Seals page
- Rank-badge medallion with rotating sun-rays halo, tier-coloured glow.
- Five vertical "tier lanterns" replacing the inline legend.
- Quest panel pointing at the closest unearned seal.
- "CHAPITRE COMPLET" gold banner with sweeping shimmer per finished category.
- Floating sakura petals across the page.

### Step 13 — Tag editing + cleanup pass (v2.9.0)
- **Genre editing** for custom-only library rows (mal_id < 0 AND no
  mangadex_id) — inline chip editor with autocomplete, saves alongside
  publisher/edition via the existing patch endpoint.
- **OfflineBanner debounce** — 800ms threshold so quick saves no longer
  trigger a "Syncing N changes" flicker.
- **Dedup pass**: `summarizeRange`, `formatShortDate` (front), `derive_hanko`
  (back) extracted into shared utils.
- **Coffret + store validation** — `COFFRET_NAME_MAX_LEN = 100`,
  `STORE_MAX_LEN = 80` enforced server-side via `sanitize_label`,
  closing a defense-in-depth gap.
- **Frontend / backend constraint audit** — full sweep of `maxLength` JSX
  vs server `*_MAX_LEN` constants; misalignments fixed.
- **Security audit** — SQL injection (clean), IDOR (clean, every by-id
  query paired with user_id filter), CSRF (active state-check + middleware),
  XSS (no `dangerouslySetInnerHTML` anywhere), SSRF (all external URLs
  config-derived), path traversal (storage paths built from i32s only).

---

## Stats

| Phase | Commits | Notable |
|---|---|---|
| 1 (solo) | 62 | OAuth, Knex, MAL sync, posters |
| 2 (AI-assisted) | 146 | Rust port, 31-seal system, public profiles, realtime, full UI redesign |
| **Total** | **208** | 8 minor releases, v1 → v2.9 |
