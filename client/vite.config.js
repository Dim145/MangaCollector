import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants as zlibConstants, gzip } from "node:zlib";
import { promisify } from "node:util";
import i18nSplit, { parseI18nId } from "./plugins/i18n-split.js";
import { PAGE_NAMESPACES } from "./src/i18n/split.js";


/**
 * 道 · Route-chunk preload — the page a visit lands on, fetched beside
 * the entry instead of after it.
 *
 * Every route is `React.lazy`, so its chunk was only requested once the
 * entry had run, the language had loaded and React had rendered the
 * `<Suspense>` around it: one more round trip in series, on the path to
 * the page's largest element. The bundle knows which chunk each route
 * is and what it imports, so the inline script below asks for exactly
 * those files for `location.pathname`, minus whatever the entry already
 * preloads. A key ending in `/` is a prefix — `/author/` is every
 * `/author/:malId` — and the longest one that matches wins. A route not
 * in this table simply loads as before.
 *
 * It is the same table as `PAGE_PATHS` in `src/routePages.js`, which
 * `main.jsx` reads to load that page before the first render;
 * `routePages.test.js` fails when the two disagree. A missing row costs
 * the round trip, never correctness.
 */
const ROUTE_MODULES = {
  "/": "src/components/About.jsx",
  "/log-in": "src/components/Login.jsx",
  "/dashboard": "src/components/Dashboard.jsx",
  "/mangapage": "src/components/MangaPageRoute.jsx",
  "/addmanga": "src/components/AddPage.jsx",
  "/profile": "src/components/ProfilePage.jsx",
  "/stats": "src/components/StatsPage.jsx",
  "/settings": "src/components/SettingsPage.jsx",
  "/calendrier": "src/components/CalendarPage.jsx",
  "/scan": "src/components/ScanPage.jsx",
  "/backlog": "src/components/BacklogPage.jsx",
  "/rangement": "src/components/RangementPage.jsx",
  "/inventaire": "src/components/InventoryPage.jsx",
  "/seals": "src/components/SealsPage.jsx",
  "/friends": "src/components/FriendsPage.jsx",
  "/snapshots": "src/components/SnapshotsPage.jsx",
  "/year-in-review": "src/components/YearInReviewPage.jsx",
  "/aide": "src/components/HelpPage.jsx",
  "/glossary": "src/components/GlossaryPage.jsx",
  "/settings/import-external": "src/components/ImportExternalPage.jsx",
  "/settings/shelf-stickers": "src/components/ShelfStickersPage.jsx",
  "/year-in-review/": "src/components/YearInReviewPage.jsx",
  "/u/": "src/components/PublicProfile.jsx",
  "/author/": "src/components/AuthorPage.jsx",
  "/publisher/": "src/components/CollectionPage.jsx",
  "/edition/": "src/components/CollectionPage.jsx",
  "/compare/": "src/components/ComparePage.jsx",
};

function staticClosure(bundle, chunk, into = new Set()) {
  for (const file of chunk.imports ?? []) {
    if (into.has(file)) continue;
    into.add(file);
    const next = bundle[file];
    if (next?.type === "chunk") staticClosure(bundle, next, into);
  }
  return into;
}

/**
 * 先 · Boot preload — what the first render waits for, requested beside
 * the entry instead of after it.
 *
 * Three things are only reachable through a runtime `import()`, which
 * the HTML parser cannot see, so each used to cost a round trip in
 * series after the entry had run:
 *
 *   - the reader's language — the core of its catalogue (`i18n/split.js`),
 *     picked from `localStorage["mc:lang"]` like `bootstrapLanguage` does;
 *   - the page the address names and the chunks it imports, minus what
 *     the entry already preloads (`ROUTE_MODULES` above);
 *   - that page's own text, in that language (`PAGE_NAMESPACES`).
 *
 * The bundle knows every file name, so the inline script below asks for
 * exactly those, in parallel with the entry. Only the reader's language
 * is fetched: the three carry the same keys (`i18n/parity.test.js`), so
 * an English fallback would be downloaded for nothing.
 *
 * It sits at the end of `<head>`, after the stylesheet, and that is
 * deliberate. An inline script behind a stylesheet still loading waits
 * for it, so these requests start only once the CSS has arrived — which
 * is what lets the CSS have the connection to itself. Measured both ways
 * on a first visit (slow 4G, CPU ×4, `scripts/perf/trace.mjs`, three
 * runs each): ahead of the stylesheet, the first paint moved from 1.25 s
 * to 1.78 s and the page mounted no sooner (/stats 3.56 → 3.59 s,
 * /dashboard 4.12 → 4.19 s) — the entry's own chain is longer than the
 * wait, so starting these earlier only took bandwidth from the styles.
 */
function bootPreloadInjector() {
  let table = null;
  return {
    name: "boot-preload-injector",
    apply: "build",
    generateBundle(_, bundle) {
      const byFacade = new Map();
      const text = {};
      let entry = null;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        if (chunk.isEntry) entry = chunk;
        if (!chunk.facadeModuleId) continue;
        byFacade.set(chunk.facadeModuleId, chunk);
        const part = parseI18nId(chunk.facadeModuleId);
        if (part?.lang) (text[part.lang] ??= {})[part.chunk] = `/${chunk.fileName}`;
      }
      if (!entry) return;
      const preloaded = staticClosure(bundle, entry, new Set([entry.fileName]));
      const routes = {};
      for (const [route, rel] of Object.entries(ROUTE_MODULES)) {
        const chunk = byFacade.get(path.resolve(import.meta.dirname, rel));
        if (!chunk) continue;
        const files = staticClosure(bundle, chunk, new Set([chunk.fileName]));
        routes[route] = {
          f: [...files].filter((file) => !preloaded.has(file)).map((file) => `/${file}`),
          t: PAGE_NAMESPACES[path.basename(rel, ".jsx")] ?? [],
        };
      }
      table = { text, routes };
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (!table?.text?.en) return html;
        const script = `
    <script>
      (function () {
        try {
          var c = ${JSON.stringify(table.text)};
          var r = ${JSON.stringify(table.routes)};
          var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
          var stored = localStorage.getItem("mc:lang");
          var t = c[stored && own(c, stored) ? stored : "en"];
          var p = location.pathname, e = own(r, p) ? r[p] : null, k, best = "", i;
          if (!e) {
            for (k in r) if (k.length > best.length && k.charAt(k.length - 1) === "/" && k !== "/" && p.length > k.length && p.indexOf(k) === 0) best = k;
            e = best ? r[best] : null;
          }
          var add = function (href) {
            if (!href) return;
            var l = document.createElement("link");
            l.rel = "modulepreload";
            l.crossOrigin = "";
            l.href = href;
            document.head.appendChild(l);
          };
          add(t.core);
          if (e) {
            for (i = 0; i < e.f.length; i++) add(e.f[i]);
            for (i = 0; i < e.t.length; i++) add(t[e.t[i]]);
          }
        } catch (_) {}
      })();
    </script>`;
        return html.replace("</head>", `${script}\n  </head>`);
      },
    },
  };
}

/**
 * 字 · Font preload — the two faces the first screen sets most of its
 * text in (Fraunces' upright, Instrument Sans' upright), declared in the
 * HTML so they download beside the scripts instead of after the first
 * render asked for them. Measured with and without (Lighthouse mobile,
 * three runs, 2026-10-10): first paint 3.8 → 3.4 s on every page, the
 * largest paint unchanged within noise.
 */
const FONT_PRELOADS = [
  "fraunces-latin-opsz-normal",
  "instrument-sans-latin-wght-normal",
];

function fontPreloadInjector() {
  let hrefs = [];
  return {
    name: "font-preload-injector",
    apply: "build",
    generateBundle(_, bundle) {
      hrefs = [];
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".woff2")) continue;
        const base = asset.fileName.split("/").pop();
        if (FONT_PRELOADS.some((name) => base.startsWith(`${name}-`))) {
          hrefs.push(`/${asset.fileName}`);
        }
      }
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (hrefs.length === 0) return html;
        const links = hrefs
          .map(
            (href) =>
              `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`,
          )
          .join("\n    ");
        return html.replace("<title>", `${links}\n    <title>`);
      },
    },
  };
}

/**
 * 圧 · Precompressed assets — every text file the build emits gets a
 * `.gz` twin at maximum compression, which nginx serves as is
 * (`gzip_static on`, `nginx.conf`). It used to compress each response on
 * the fly at level 6: CPU on every request for files that never change,
 * and a few percent bigger than they could be. `index.html` is left out
 * — the container templates it at start, so a twin made here would be
 * stale — as are files below nginx's `gzip_min_length` and the already
 * compressed formats (woff2, images).
 */
const gzipAsync = promisify(gzip);
const PRECOMPRESS = /\.(?:js|mjs|css|svg|json|webmanifest|txt|xml|wasm)$/;

function precompressAssets() {
  let outDir = "dist";
  return {
    name: "precompress-assets",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const walk = async (dir) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(file);
            continue;
          }
          if (!PRECOMPRESS.test(entry.name)) continue;
          if ((await stat(file)).size < 512) continue;
          const body = await gzipAsync(await readFile(file), {
            level: zlibConstants.Z_BEST_COMPRESSION,
          });
          await writeFile(`${file}.gz`, body);
        }
      };
      await walk(outDir);
    },
  };
}

/*
 * Vite 8 + vite-plugin-pwa: 1.3.0 declares `vite ^8` in its peer
 * dependencies, so the `peerDependencyRules` exception package.json used
 * to carry for 1.2.0 is gone.
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
    // 編 · No React Compiler. Measured (plugin-react 6.1's Oxc port,
    // 2026-10-11): +143 kB gz over the build and +16.5 kB gz on the
    // dashboard's critical path, for interactions 15–35 % faster at CPU ×4
    // that were already under 200 ms — and it skipped `Dashboard` and
    // `MangaPage` outright (a destructured `for…of`, a `try` without
    // `catch`). Worth trying again when the port compiles those two.
    react(),
    tailwindcss(),
    i18nSplit({ dir: path.resolve(import.meta.dirname, "src/i18n") }),
    bootPreloadInjector(),
    fontPreloadInjector(),
    precompressAssets(),
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
      // 重 · The manifest's icons used to be added on top of the precache
      // glob, which listed six files twice. The glob (and its ignores,
      // below) alone decides what is precached.
      includeManifestIcons: false,
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
        // PDF stack behind the label sheet, the two languages this
        // reader is not using, the landing
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
          "**/html-to-image-*.js", // the Year in Review export
          "**/rum-*.js", // web-vitals, only where the operator set RUM_ENABLED
          "**/labels.worker-*.js", // the label sheet, built off the page
          "**/index.es-*.js", // canvg, jsPDF's SVG path
          "**/JsBarcode*.js",
          // 言 · The catalogues: a core and per-page chunks for each of
          // three languages, of which one is ever active — fetched with
          // the page, then kept by the cache-first rule below.
          "**/i18n-*.js",
          "**/{library,series,volumes,stats}-{800,1400}*.{jpg,webp,avif}", // landing
          "**/*-vietnamese-*.woff2", // a slice en/fr/es never asks for
          // 荷 · Satellites of the libraries above, emitted under names of
          // their own: DOMPurify comes with jsPDF, the ponyfill is the
          // barcode decoder for browsers without a native one. Both are
          // fetched with the feature that needs them.
          "**/purify.es-*.js",
          "**/ponyfill-*.js",
          // The 404 page's illustration — a lost reader's page, not the
          // shell.
          "**/chibi-archivist-*.svg",
          // Read by the operating system when the app is installed, never
          // by the page: precaching them only added 150 kB to the install.
          "pwa-512x512.png",
          "pwa-maskable.png",
          "apple-touch-icon.png",
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
          // 源 · No Jikan rule. The browser no longer calls Jikan: the
          // recommendations, characters and details it showed come
          // from `/api/external/mal/…`, cached in Dexie, so the
          // operator's choice of upstream applies there too.
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
          // 影 · Covers relayed by the server (`PROXY_COVERS`). Each URL
          // names one rendition for good (the server answers it
          // `immutable`), so cache-first is exact — and it is what keeps
          // a relayed shelf readable offline, which the browser's HTTP
          // cache alone does not promise. Private: which covers a device
          // asked for is the reader's library, so the bucket is purged
          // with the others (`lib/privateCaches.js`).
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && url.pathname === "/api/user/cover",
            handler: "CacheFirst",
            options: {
              cacheName: "relayed-covers",
              expiration: {
                maxEntries: 800,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          // 写 · Shelf photos. Their URL carries `?v=` the moment they
          // were taken (`services/locations.rs::photo_url`), so a new
          // photo is a new URL and cache-first never shows a stale one.
          {
            urlPattern: /\/api\/user\/locations\/\d+\/photo\?v=\d+$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "place-photos",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [200] },
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
  // 札 · Workers as ES modules: the label-sheet worker imports jsPDF
  // and JsBarcode on demand (`lib/labels.worker.js`), and only the ES
  // format lets a worker bundle split like that.
  worker: { format: "es" },
  build: {
    // 先 · No modulepreload polyfill. Every browser the app supports
    // understands `<link rel="modulepreload">` (Safari 17, Firefox 115,
    // Chromium 66); the polyfill was a script in the entry chunk that
    // looked for the links and re-fetched them by hand on browsers that
    // do not, and a MutationObserver watching the whole document for new
    // ones — for nobody. Without it, an older browser loads each module
    // when it is imported, which is slower and still correct.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        // 言 · The catalogue chunks get names that say what they are —
        // `i18n-fr-settings-<hash>.js` — so the precache can leave them
        // out by pattern and a waterfall reads at a glance.
        chunkFileNames(chunk) {
          const part = parseI18nId(chunk.facadeModuleId);
          return part?.lang
            ? `assets/i18n-${part.lang}-${part.chunk}-[hash].js`
            : "assets/[name]-[hash].js";
        },
        // Split heavy, stable-API libraries into their own chunks so
        // their hashes don't churn on every app-code change — better
        // long-term browser cache hit rate, faster repeat visits, and
        // a smaller download after each deploy (the service worker
        // fetches only the files whose hash changed).
        //
        // 割 · `codeSplitting` groups — Rolldown's own form. The
        // `manualChunks` function this replaces is deprecated in
        // Rolldown 1.0 (and silently ignored once `codeSplitting` is
        // set); the buckets are the same. The tests match the
        // `node_modules/<package>/` segment, which is also what pnpm's
        // `.pnpm/<pkg>@<v>/node_modules/<pkg>/` layout ends with.
        //
        // 図 · No bucket for a chart library: there is none any more. The
        // stats page draws its four charts in plain SVG
        // (`components/analytics/charts/`), which replaced 92 kB gz of
        // recharts + d3 + redux. The lesson that came with it stands for
        // any heavy dependency: a bucket only pays for itself when the
        // pages that need it are the pages that load it — forcing every
        // `d3-*` package into one chunk once put 107 kB gz on the first
        // visit of pages with no chart on them.
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: "storage",
              test: /[\\/]node_modules[\\/](dexie|dexie-react-hooks|@tanstack[\\/](react-query|query-core))[\\/]/,
              priority: 10,
            },
            // 名 · A name for the Year in Review's image export, which
            // the bundler otherwise called `es` after the package's
            // `es/` folder — a name the language pattern of the precache
            // used to match by accident.
            {
              name: "html-to-image",
              test: /[\\/]node_modules[\\/]html-to-image[\\/]/,
              priority: 5,
            },
          ],
        },
      },
    },
  },
});
