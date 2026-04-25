import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

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
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "pwa-192x192.png",
        "pwa-512x512.png",
        "pwa-maskable.png",
        "apple-touch-icon.png",
        // App-shortcut icons — referenced by the manifest's `shortcuts`
        // entries and need to be in the precache so the launcher menu
        // works even when the user is offline at the moment of long-
        // press. Kept as SVGs (~400 B each) rather than PNG sprites.
        "shortcut-scan.svg",
        "shortcut-add.svg",
        "shortcut-profile.svg",
      ],
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
        // Skip the backend — we handle offline/sync at the app layer
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/auth/],
        runtimeCaching: [
          // Google Fonts stylesheets
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-stylesheets",
            },
          },
          // Google Fonts webfont files
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
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
            if (id.includes("/recharts/") || id.includes("/d3-")) {
              return "charts";
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
