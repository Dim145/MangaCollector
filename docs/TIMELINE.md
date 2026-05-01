# MangaCollector — Project Timeline

A condensed history of every meaningful change since the project was
forked, walking from the bare-bones URL-cleanup commit through the
v2.10.0 release.

**226 commits across two distinct development phases**:
- **Phase 1 (solo)**: 62 commits laying the auth, storage and metadata
  foundations.
- **Phase 2 (AI-assisted)**: 164 commits — feature explosion, full Rust
  port, full UI redesign, nine version bumps.

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

### Step 14 — Polish, power & celebration (v2.10.0)
A wide release combining a heavy performance pass, a power-user
productivity layer, a visual-delight tier, and a self-hostable
observability stack. **18 commits**, **+7 845 / −468 lines** across
**92 files**. Every new user-controllable setting persists to the
database — no hidden localStorage state.

#### Performance & rendering
- **View Transitions API** — page-to-page navigation cross-fades and
  slides natively where the browser supports it; falls back to plain
  navigation otherwise.
- **Virtualized manga grid** — windowed rendering via
  `@tanstack/react-virtual` past 100 entries, overscan tuned for
  View Transitions compatibility.
- **LQIP placeholders** + richer skeletons — `CoverImage` shows a
  blurred low-quality preview during the actual fetch;
  `MangaPageSkeleton` mimics the final layout shape (zero CLS).
- **Predictive prefetch** + **pull-to-refresh** — likely-next routes
  warm in the background; a native-feeling touch gesture re-syncs
  the dashboard on mobile.
- **Lazy-loaded i18n bundles** — each language is its own code-split
  chunk, with a Vite plugin injecting `<link rel="modulepreload">` at
  HTML parse time so visitors download only what they need without an
  RTT penalty. Main JS chunk dropped from **578 kB → 383 kB** (−34%).

#### Power-user productivity
- **Command palette** at `⌘K` / `Ctrl+K` — fuzzy search across routes,
  series, settings, quick actions; mounted globally.
- **Keyboard shortcuts** + `g`-chord nav — `g d` (dashboard), `g l`
  (library), `g c` (calendrier), `g s` (settings), … `?` opens the
  full cheat sheet.
- **Quick-add paste** — paste a MAL URL or ISBN anywhere; the
  add-flow opens pre-filled.
- **Bulk select & cascade actions** — toggle owned / unowned / read /
  unread / delete on every volume in a series in one gesture, fully
  **offline-capable** via Dexie outbox + chronological replay.

#### Visual delight
- **Eight accent colours** — switch the app's red between traditional
  Japanese hues (朱・金・萌黄・桜・藍・黒・紫・茜) through OKLCH CSS
  variables; persisted server-side, applied synchronously at boot via
  inline `<script>` (no FOUC).
- **3D shelf view (棚)** — optional perspective tilt on the volume
  shelf with per-row offsets and a wood-grain backdrop; honours
  `prefers-reduced-motion`.
- **Streak (連)** — current and best daily-activity streak surfaced
  as a chip; server-computed, Dexie-cached, offline-friendly. Local
  label "Suite" (FR) chosen to avoid collision with "séries" (mangas).
- **Tier-aware seal chime** — bronze / silver / gold / platinum /
  legendary stamps each ring with their own note count + bass weight,
  synthesised on the Web Audio graph.
- **Configurable haptics + sounds** — opt-in vibration and audio cues
  centralised through `SyncToaster` so notification, sync, ceremony
  share one envelope shape.
- **Shelf snapshot** — generate a 1080×1350 PNG poster of your top
  covers + stats + accent-coloured progress, sharable via Web Share
  API or one-tap download.

#### Self-hostable observability
- **Umami analytics** — opt-in privacy-first pageviews. Configured via
  `UMAMI_HOST` + `UMAMI_WEBSITE_ID` env vars rendered into the
  nginx-served `index.html` at container start (envsubst), so the
  same image works for cloud, self-host, and air-gapped deploys.
- **Sentry / Bugsink** — wire-compatible error tracking via a single
  SDK path. Backend enforces a **mutex**: `SENTRY_DSN` XOR
  `BUGSINK_DSN`, never both. Loader fails silently when unreachable
  on first paint.

#### Fixes & internals
- **`sanitize_genres` allocation** — bounded `Vec::with_capacity` to
  the genre cap (CodeQL `rust/uncontrolled-allocation-size`).
- **Italic gradient paint** on the SealsPage hero — italic Fraunces
  digits' rightward slant escapes `background-clip: text` paint area;
  fixed with `pr-[0.3em]` on the gradient span and a matching
  `-mr-[0.3em]` on the wrapper to preserve kerning.
- **Accent FOUC** + **calendar route 404** + **streak route nesting**
  — three boot-path bugs caught and fixed.
- **Qodana** configs added for both frontend and backend.
- **Dexie schema → v9** — `streak` cache table + `outboxBulkMark`
  table; `outboxTags` dropped (Tier 7.4 user-tags reverted as too
  confusing alongside genres).
- **Glossary expansion** — 10 new kanji entries (連・新・眠・慕 in
  states; 選・削・鍵・解・確 in actions; 棚 in vessels) across all
  three locales.

---

## Stats

| Phase | Commits | Notable |
|---|---|---|
| 1 (solo) | 62 | OAuth, Knex, MAL sync, posters |
| 2 (AI-assisted) | 164 | Rust port, 31-seal system, public profiles, realtime, full UI redesign, performance + delight tiers, observability stack |
| **Total** | **226** | 9 minor releases, v1 → v2.10 |
