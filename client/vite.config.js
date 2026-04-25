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
          // Jikan (MAL) API — read-only metadata, cache aggressively
          {
            urlPattern: /^https:\/\/api\.jikan\.moe\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "jikan-api",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
          // MAL / Jikan cover images
          {
            urlPattern: /^https:\/\/cdn\.myanimelist\.net\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "mal-covers",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          // User-uploaded posters via backend — cache so covers stay visible offline
          {
            urlPattern: /\/api\/user\/storage\/poster\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "user-posters",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
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
