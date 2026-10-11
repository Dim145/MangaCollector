# Performance measurements

Lab measurements of the client, against the local test stack. They are
how the numbers in `client/perf-budget.json`, in the comments of
`vite.config.js` and in the module docs were obtained — rerun them
before and after a change that is meant to make something faster.

| Script | Answers |
|---|---|
| `signin.mjs` | Signs in on the test stack and keeps the session for the others |
| `lighthouse.mjs` | Lighthouse (performance, accessibility, best practices), several runs per page, the median kept |
| `trace.mjs` | One load, traced at CPU ×4: first paint, every LCP candidate, when chosen elements entered the DOM, long tasks, and the main thread's script / style / layout / paint |
| `coverage.mjs` | How much of each JavaScript file a page runs |
| `a11y.mjs` | Lighthouse's accessibility audit (axe-core) on every page, with the failing audits and the elements at fault — exits 1 under 100 |
| `../perf-budget.mjs` | What a first visit downloads before a page can draw — run by CI on every build, no browser needed |

## Setting up

1. The test stack and a seeded library — `docs/test-stack.md`, then
   `node scripts/seed-test-stack.mjs --big`.
2. A production build served locally:

   ```bash
   cd client && pnpm build && pnpm preview
   ```

   The preview listens on `:4173`; set `PERF_BASE` for anything else.
3. The tools, from the public registry:

   ```bash
   cd scripts/perf && npm install --registry=https://registry.npmjs.org/
   ```

4. A Chromium for them to drive, in `CHROME_BIN` — Chrome, or the
   headless shell Playwright keeps in its cache:

   ```bash
   export CHROME_BIN=~/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell
   ```

5. `node signin.mjs` once per session.

Reports go to `scripts/perf/.out/` (ignored by git).

## Running

```bash
RUNS=3 node lighthouse.mjs /dashboard /stats
FORM=desktop node lighthouse.mjs /dashboard
COLD=1 node lighthouse.mjs /stats
ANON=1 node lighthouse.mjs / /log-in
MARK="hero=header.washi-aged" node trace.mjs /stats
COLD=1 MARK="grid=main img" node trace.mjs /dashboard
node coverage.mjs /stats /settings
node a11y.mjs                      # the 16 signed-in pages, phone
FORM=desktop node a11y.mjs
ANON=1 node a11y.mjs               # landing, sign-in, help, glossary
node scroll-nav.mjs                # library ⇄ series and fast scrolls, phone at CPU ×4
node scroll-nav.mjs --device desktop --rounds 6 --frames
node overlay-open.mjs --frames     # the volume drawer opening (Edit, an announced tome)
node overlay-open.mjs --device phone   # …and the library's filter sheet
node popover-scroll.mjs            # the account menu while the page scrolls under it
```

`overlay-open.mjs` follows the leading edge of a panel as it arrives
and the scroll of the dialog around it. A panel slides one way and
stops; one that "went N px past its place" or a dialog "scrolled up to
N px" is the bug below. Read the screencast too: measuring a position
from script forces the layout that hides it — the numbers alone once
showed a drawer standing still that the frames showed overshooting.

`scroll-nav.mjs` signs in through the provider itself and records every
frame: where the library comes back to after a series (browser back and
the page's own "Back to library"), the frames it spends anywhere else,
covers missing or fading in, and — on a fast wheel or swipe — content
moving under the gesture. `--frames` keeps the screencast in
`.out/scroll-nav/` to look at what the numbers say. It finds tiles by
their structure, not by attributes a version may lack, so pointing
`PERF_BASE` at an older release measures that release.

`COLD=1` empties IndexedDB and localStorage first, so the page starts
without the device cache a returning reader has.

## Reading the numbers

- **Lighthouse simulates a slow network** (1.6 Mbps, 150 ms) and a 4×
  slower CPU on top of what it observed. Its timings move with bytes
  more than with anything else; `trace.mjs` shows what the CPU does on
  a fast network. They answer different questions — use both.
- **Read the `bytes` column before comparing two runs.** The dashboard
  is bimodal: when its MangaDex covers load inside the measured window,
  one of them is the LCP element, and a `.512` MangaDex thumbnail weighs
  115–252 kB, so the simulated LCP lands near 8 s; when they do not, it
  lands near 5 s. Medians of three runs or more.
- **Writes fail on the preview.** The test stack's `FRONTEND_URL` is
  `http://localhost:5173`, and the server's CSRF guard refuses a
  state-changing request whose `Origin` is anything else — `:4173`
  included. Measure writes against `pnpm dev` (`PERF_BASE=http://localhost:5173`).
- **One console error is expected on the preview**: its proxy does not
  carry the session to `/api/ws`, so the WebSocket is refused and
  Lighthouse's "errors in console" audit fails. Production is not
  affected.
- **Observed timings at 4× CPU on this machine are not a phone.** They
  rank changes reliably; they do not predict a field LCP.

## What they found (2026-10)

- Coming back from a series, the library showed its top, then jumped —
  sometimes a row or a whole screen away from where the reader had been
  — and a fast scroll up the shelf jumped as rows grew. The card is a
  `<button>`, which is as wide as its content: wrapped in its list item
  it measured 2 px until its cover loaded, the windowed grid learnt a
  15 px row from it and laid out the shelf at a sixteenth of its height
  (`Manga.jsx`, `w-full`). Then the seasonal banner, gone on the second
  mount, moved the shelf by 66 px (`lib/season.js`), and every return
  painted the skeleton and the shelf's top before the restore
  (`lib/warmReads.js`, `restoringTo` in `lib/scrollMemory.js`), with
  each cover's swatch and fade played again (`lib/seenCovers.js`).
  Measured with `scroll-nav.mjs`: from 1.5 s at the wrong place to the
  first frame in the right one, 0 px off.
- The account menu climbed with a slow scroll and stood mid-screen for
  an instant on a fast one, then went back: anchored to a button in the
  sticky header, it got the scroll compensation meant for an anchor
  that scrolls away. Not reproduced in Chromium (`popover-scroll.mjs`
  finds it still in both of ours) — most likely WebKit's behaviour.
  A pinned button's panel is placed from its rectangle now.
- The volume drawer appeared 80 px left of its place and jumped back:
  native `<dialog>`s scroll by default, the drawer arriving translated
  by its own width made it 416 px wide to scroll, and the opening focus
  scrolled it. 2.16.3's `<div>` overlay never scrolled. Every dialog is
  `overflow-clip` now — `overlay-open.mjs`.

- React 19 holds a route's content back 300 ms after its `<Suspense>`
  fallback was shown (`FALLBACK_THROTTLE_MS`). Every page paid it on
  every cold start — `client/src/lib/lazyRoute.js`.
- The stats page styled and laid out all seven of its sections before
  its title could paint — `hooks/useAfterFirstPaint.js`.
- The largest element of the stats page was a 7 %-opacity kanji waiting
  for 80 kB of Noto Serif JP — `styles/fonts.css`, `font-display: optional`.
- Half of each language catalogue was one page's text —
  `client/src/i18n/split.js`.
