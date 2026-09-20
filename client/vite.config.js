import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

/**
 * 言 · i18n preload injector — eliminates the cold-start RTT cost of
 * lazy-loading language bundles.
 *
 * Without this plugin, the browser timeline on first visit is:
 *
 *   HTML parse → fetch main.js → parse → loadLanguage() fires
 *                                            ↓
 *                                       fetch lang chunk (+1 RTT)
 *                                            ↓
 *                                       React mounts
 *
 * The lang chunk fetch is serial after main.js parses because the
 * dynamic `import()` is invisible to the HTML parser — Vite/Rolldown
 * doesn't generate `<link rel="modulepreload">` for chunks reached only
 * via runtime `import()`.
 *
 * This plugin captures the emitted lang chunk filenames at
 * `generateBundle` time, then injects an inline `<script>` into
 * `<head>` that:
 *   1. Reads `localStorage["mc:lang"]` (same key as `bootstrapLanguage`)
 *   2. Injects `<link rel="modulepreload">` for the active language
 *      AND English (the fallback) before main.js even starts fetching
 *
 * Result: the lang chunks fetch in PARALLEL with main.js, so by the
 * time `loadLanguage()` is called, the bundle is already in the
 * browser cache. No RTT cost. Cost on visits 2+ is zero anyway because
 * the SW precache serves the chunks instantly.
 *
 * Build-only: `apply: "build"` skips this in dev where chunks don't
 * have stable filenames.
 */
function i18nPreloadInjector() {
  let manifest = null;
  return {
    name: "i18n-preload-injector",
    apply: "build",
    generateBundle(_, bundle) {
      manifest = {};
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        const id = chunk.facadeModuleId ?? "";
        if (id.endsWith("/i18n/en.js")) manifest.en = `/${fileName}`;
        else if (id.endsWith("/i18n/fr.js")) manifest.fr = `/${fileName}`;
        else if (id.endsWith("/i18n/es.js")) manifest.es = `/${fileName}`;
      }
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (!manifest || Object.keys(manifest).length === 0) return html;
        const script = `\n    <script>\n      (function () {\n        try {\n          var m = ${JSON.stringify(manifest)};\n          var stored = localStorage.getItem("mc:lang");\n          var lang = stored && m[stored] ? stored : "en";\n          var add = function (href) {\n            var l = document.createElement("link");\n            l.rel = "modulepreload";\n            l.crossOrigin = "";\n            l.href = href;\n            document.head.appendChild(l);\n          };\n          if (m[lang]) add(m[lang]);\n          if (lang !== "en" && m.en) add(m.en);\n        } catch (_) {}\n      })();\n    </script>`;
        return html.replace("</head>", `${script}\n  </head>`);
      },
    },
  };
}

/*
 * Vite 8 + vite-plugin-pwa override.
 *
 * Vite 8 ships the rolldown-vite merge (Rollup → Rolldown bundler).
 * `vite-plugin-pwa@1.2.0` already works with it in practice (community
 * confirmed in vite-pwa/vite-plugin-pwa#918) — only its
 * `peerDependencies.vite` declaration still caps at `^7`. PR #924
 * (approved by 5 reviewers, 2026-04) adds `^8` and is awaiting a
 * batched 1.3.0 release. Until then we use an `npm overrides` block
 * in package.json to relax the peer dep at install time.
 *
 * When `vite-plugin-pwa@1.3.0` lands: drop the `overrides` field
 * from package.json — the peer dep declaration will be honest, no
 * workaround needed.
 *
 * `@vitejs/plugin-react` is paired with the bundler: 5.x for Vite 7,
 * 6.x for Vite 8. We're on the 6.x line.
 */
/*
 * 試 · Optional dev proxy. `pnpm dev` alone has no way to reach a
 * backend — the Docker stack routes /api and /auth through Traefik,
 * and a bare Vite server answers those paths with its own 404. Set
 * `VITE_API_PROXY=http://localhost:3000` to forward them to a locally
 * running `cargo run`, websocket included. Unset (the default) leaves
 * the config exactly as before, so nothing changes for anyone else.
 * See docs/test-stack.md.
 */
const apiProxy = process.env.VITE_API_PROXY;
const devProxy = apiProxy
  ? {
      "/api": { target: apiProxy, changeOrigin: false, ws: true },
      "/auth": { target: apiProxy, changeOrigin: false },
      "/public": { target: apiProxy, changeOrigin: false },
      // 接 · The MCP endpoint and its RFC 9728 metadata. Without these
      // two, the ready-made `claude mcp add` command that Réglages →
      // Accès API hands you points at the Vite origin and 404s — which
      // reads as a broken key rather than a missing dev proxy.
      "/mcp": { target: apiProxy, changeOrigin: false },
      "/.well-known/oauth-protected-resource": {
        target: apiProxy,
        changeOrigin: false,
      },
    }
  : undefined;

// https://vite.dev/config/
export default defineConfig({
  server: devProxy ? { proxy: devProxy } : undefined,
  plugins: [
    react(),
    tailwindcss(),
    i18nPreloadInjector(),
    VitePWA({
      // 更 · `prompt` mode hands control of the SW activation to
      // the SPA via `useRegisterSW`. We mount a `<UpdatePrompt>`
      // banner that fires on `needRefresh` and lets the user
      // reload at a convenient moment (rather than the previous
      // `autoUpdate` behaviour, which silently swapped the SW
      // and made the user discover the new code only on next hard
      // refresh — too easy to keep running on stale assets).
      // `cleanupOutdatedCaches` below still purges old workbox
      // buckets the moment the new SW activates, so the
      // transition is clean once the user clicks reload.
      registerType: "prompt",
      injectRegister: false,
      // 重 · No `includeAssets`. The icons it used to name — the three
      // PWA icons, the Apple touch icon, the three shortcut SVGs — sit
      // in `public/`, and `globPatterns` below already matches every
      // `.png` and `.svg` the build emits, so naming them again put
      // each one in the manifest twice. Harmless to the cache, which
      // keys on the URL, but it meant a 120 kB maskable icon counted
      // twice against the install. Add the option back only for
      // something `globPatterns` cannot reach.
      manifest: {
        name: "MangaCollector",
        short_name: "MangaCol",
        description:
          "Archive, curate and cherish your manga library — volume by volume.",
        theme_color: "#161012",
        background_color: "#0a0908",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        // 共有 · Web Share Target — registers MangaCollector as a
        // recipient in the OS share sheet. When the user shares a URL
        // or text from any other app (browser, Twitter, Mangadex,
        // Amazon, Vinted, …) MangaCollector appears in the menu and,
        // on tap, lands on /addmanga with the share carried in query
        // params. lib/share.js picks the best candidate and pre-fills
        // the search bar; the destination page also auto-runs the
        // MAL/MangaDex search if the user is online.
        //
        // GET method keeps the integration server-less — the SPA reads
        // window.location at first render, no POST body to handle.
        share_target: {
          action: "/addmanga",
          method: "GET",
          params: {
            title: "share_title",
            text: "share_text",
            url: "share_url",
          },
        },
        // App shortcuts — surfaced by the OS launcher when the user
        // long-presses the installed PWA icon (Android Chrome / Edge,
        // Windows Edge). iOS Safari ignores this field; Apple gates
        // shortcuts behind the App Store review pipeline.
        //
        // Each `url` opens the SPA at a route that knows how to honour
        // a `shortcut=…` query param: AddPage opens the camera scanner
        // for `scan`, autofocuses the search input for `library`, and
        // ProfilePage routes plainly. Keeping the param in the URL (vs
        // sessionStorage) means the destination page can react during
        // its very first render — there's no welcome modal in the
        // shortcut flow to relay the intent.
        shortcuts: [
          {
            name: "Scan an ISBN",
            short_name: "Scan",
            description: "Open the barcode scanner",
            url: "/addmanga?shortcut=scan",
            icons: [
              { src: "/shortcut-scan.svg", sizes: "96x96", type: "image/svg+xml" },
            ],
          },
          {
            name: "Add a series",
            short_name: "Add",
            description: "Search MyAnimeList and add a new series",
            url: "/addmanga?shortcut=library",
            icons: [
              { src: "/shortcut-add.svg", sizes: "96x96", type: "image/svg+xml" },
            ],
          },
          {
            name: "My profile",
            short_name: "Profile",
            description: "Open the statistics dashboard",
            url: "/profile",
            icons: [
              { src: "/shortcut-profile.svg", sizes: "96x96", type: "image/svg+xml" },
            ],
          },
        ],
      },
      workbox: {
        // Precache the app shell (JS/CSS/HTML)
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,webp,woff2}"],
        // 荷 · …but not everything the build emits. Installing the app
        // downloaded 4.7 MB before it could be used once, most of it
        // for things most readers never open: the error reporter, the
        // PDF stack behind the label sheet, the charting library, the
        // two languages this reader is not using, the landing
        // screenshots a signed-in reader never sees again. Every URL
        // below is content-hashed and therefore immutable, so the
        // cache-first runtime rule further down keeps each one from
        // the moment it is first needed — offline included, from the
        // second use on. The shell that has to be there before
        // anything can render stays precached.
        globIgnores: [
          "**/prod-*.js", // Sentry / Bugsink, and only when configured
          "**/jspdf*.js",
          "**/html2canvas-*.js",
          "**/index.es-*.js", // canvg, jsPDF's SVG path
          "**/JsBarcode*.js",
          // recharts and everything built on it: our four chart
          // components and the pieces they share. Named one by one on
          // purpose — there is no glob for "reachable only from
          // Stats", so a new chart added under another name will
          // quietly rejoin the precache until it is listed here.
          "**/{CategoricalChart,CartesianGrid,BarChart}-*.js",
          "**/{ReadingChart,SpendingChart,MostValuedChart,CompositionPies}-*.js",
          "**/{en,fr,es}-*.js", // one of the three is ever active
          "**/{library,series,volumes,stats}-{800,1400}*.{jpg,webp,avif}", // landing
          "**/*-vietnamese-*.woff2", // a slice en/fr/es never asks for
        ],
        // Skip the backend — we handle offline/sync at the app layer.
        // The trailing slashes on each pattern matter: without them
        // the regex `/^\/auth/` greedily matches `/author/-1` (the
        // SPA's per-author route), kicking the navigation request
        // back to the network and breaking offline reload of
        // AuthorPage. Same defensive shape as the Traefik PathPrefix
        // fix in `docker-compose.yml`.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        // Drop runtime caches from prior deploys whose strategy or
        // version no longer matches this build. Without this, an old
        // bucket (different `cacheName`, retired URL pattern…) keeps
        // serving stale responses indefinitely until the browser quota
        // forces eviction. Workbox handles each entry individually so
        // there's no risk of nuking a still-valid bucket that happens
        // to share a substring of its name with the obsolete one.
        cleanupOutdatedCaches: true,
        // Activation strategy paired with the `prompt` register type:
        //   • `clientsClaim: true` — once the user accepts the
        //     update prompt (which calls `updateServiceWorker(true)`
        //     on the SPA side), the new SW immediately controls
        //     every open tab. Without it, a partial reload would
        //     leave some tabs on the old SW indefinitely.
        //   • `skipWaiting: false` — DO NOT auto-activate the new
        //     SW the moment it finishes installing. Wait for the
        //     SPA to call `messageSkipWaiting()` via `updateServiceWorker(true)`.
        //     This is the whole point of `prompt` mode: the user
        //     decides when to swap.
        clientsClaim: true,
        skipWaiting: false,
        runtimeCaching: [
          // 資 · Our own build output that the precache no longer
          // carries (see `globIgnores`). Cache-first without
          // revalidation is safe and correct here precisely because
          // every one of these filenames contains a hash of its
          // contents: a changed file is a different URL, and
          // `cleanupOutdatedCaches` plus the expiry below retire the
          // ones a deploy left behind.
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && url.pathname.startsWith("/assets/"),
            handler: "CacheFirst",
            options: {
              cacheName: "app-assets",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 字 · No Google Fonts rules. The four families are served from
          // this origin now (see `styles/fonts.css`), so they are
          // ordinary build output: precached with the shell, or picked
          // up by the `/assets/` rule above.
          // Jikan (MAL) API — read-only metadata, cache aggressively.
          // Bumped from 100 to 250 entries: a power user with a 200-
          // series library was evicting fresh entries on every refresh
          // because Jikan responses include character lookups that
          // count against the same bucket.
          {
            urlPattern: /^https:\/\/api\.jikan\.moe\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "jikan-api",
              expiration: {
                maxEntries: 250,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
          // MAL CDN covers — switched from CacheFirst to SWR so a
          // cover that gets refreshed on MAL's side eventually
          // propagates here. Users still see the cached image
          // instantly (no flash), the network revalidate runs in the
          // background, and the next mount picks up the new bytes.
          // 30-day expiration is the floor — the bucket otherwise
          // grows unbounded as the user explores new series.
          {
            urlPattern: /^https:\/\/cdn\.myanimelist\.net\/.*\.(?:jpg|jpeg|png|webp|gif)$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "mal-covers",
              expiration: {
                maxEntries: 800,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // MangaDex covers — `uploads.mangadex.org/covers/...` URLs
          // include the per-cover UUID and filename. A change of cover
          // mints a new URL, so we never need to revalidate; CacheFirst
          // with a 1-year horizon is correct here. Only the image
          // suffixes are matched so MD's other endpoints don't pollute
          // the bucket.
          {
            urlPattern:
              /^https:\/\/uploads\.mangadex\.org\/covers\/.*\.(?:jpg|jpeg|png|webp|gif)(?:\.\d+\.jpg)?$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "mangadex-covers",
              expiration: {
                maxEntries: 800,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Books — ISBN-scan flow embeds these thumbnails for
          // a brief recognition step. Cache so re-scans of the same
          // ISBN don't burn the daily quota; SWR is the right call
          // because Google occasionally re-encodes existing thumbnails.
          {
            urlPattern:
              /^https:\/\/books\.google\.com\/books\/content\?.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-books-thumbnails",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 設 · Public runtime config (Umami / Sentry / Bugsink DSNs
          // exposed by the backend at boot). StaleWhileRevalidate so
          // the SPA boot is instant on every reload after the first
          // online visit AND survives offline — the cached payload
          // is the last-known-good config from the backend. Single-
          // entry bucket because there's only ever one URL.
          {
            urlPattern: /\/api\/public-config$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "public-config",
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // User-uploaded posters via backend — cache so covers stay
          // visible offline. Same bucket name as before so existing
          // installs don't lose their cached covers on update.
          {
            urlPattern: /\/api\/user\/storage\/poster\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "user-posters",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Public-profile posters — anonymous visitors of /u/{slug}
          // hit `/api/public/u/{slug}/poster/{mal_id}` for each user-
          // uploaded cover. Separate bucket from `user-posters` so the
          // owner's private cache and the public one don't fight for
          // entry budget on a viewer browsing many profiles.
          {
            urlPattern: /\/api\/public\/u\/[^/]+\/poster\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "public-posters",
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 印影 · Snapshot images — `/api/user/snapshots/{id}/image`
          // is a stable URL once the snapshot is created (the image
          // never mutates: a new shelf state mints a new id, not a
          // replacement). CacheFirst with a 1-year horizon means
          // the gallery renders instantly on reload, AND viewing
          // past prints offline works without our SPA having to
          // shuttle blobs through Dexie ourselves. The matching
          // listing payload is cached separately at the Dexie layer
          // (db.snapshots).
          {
            urlPattern: /\/api\/user\/snapshots\/\d+\/image$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "snapshot-images",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy, stable-API libraries into their own chunks so
        // their hashes don't churn on every app-code change — better
        // long-term browser cache hit rate, faster repeat visits.
        //
        // Function form (vs the previous object form) is required by
        // Vite 8 / Rolldown. Same buckets as before, just expressed as
        // a `module-id → chunk-name` lookup. The `id` argument is the
        // resolved path of the module — we match by `node_modules/...`
        // to avoid colliding with our own files that happen to share
        // a name with a dep.
        //
        // 図 · There is deliberately NO bucket for recharts / d3. Naming
        // one made things worse, and the mechanism is worth writing
        // down. A chunk only pays for itself when the pages that need
        // it are the pages that load it. Forcing every `d3-*` package
        // into one chunk pulled in modules that non-chart code shares
        // (`d3-shape` reaches the seal ribbons, `d3-time-format` the
        // calendar), so 55 chunks — the entry among them — imported it,
        // and every first visit paid 372 kB (107 gz) to render a page
        // with no chart on it. Left alone, the bundler puts recharts
        // where it is used: a `CategoricalChart` chunk the seven chart
        // routes share, loaded when Stats is opened and not before.
        // Measured on this tree: critical JS 271 → 167 kB gz.
        manualChunks(id) {
          if (id.includes("/node_modules/")) {
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/react-router-dom/") ||
              id.includes("/react-router/") ||
              id.includes("/scheduler/")
            ) {
              return "react-vendor";
            }
            if (
              id.includes("/dexie/") ||
              id.includes("/dexie-react-hooks/") ||
              id.includes("/@tanstack/react-query")
            ) {
              return "storage";
            }
          }
          // Anything else falls into the default per-route chunks
          // produced by lazy imports in App.jsx.
          return undefined;
        },
      },
    },
  },
});
