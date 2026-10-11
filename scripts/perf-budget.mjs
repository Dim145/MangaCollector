#!/usr/bin/env node
/*
 * 量 · Performance budgets, checked on the production build.
 *
 *     cd client && pnpm build && node ../scripts/perf-budget.mjs
 *
 * What a first visit to a page has to download and run before that page
 * can draw, measured from `client/dist` the way the browser meets it:
 *
 *   - the entry script and everything `index.html` modulepreloads,
 *   - the core of the reader's language (English here — the three are
 *     the same size to within a few hundred bytes),
 *   - the page's own chunks and its text (`i18n/split.js`), which
 *     `index.html` modulepreloads for that address and `main.jsx` waits
 *     for (`routePages.js`),
 *
 * gzipped at level 9, as nginx serves them (`gzip_static`). Plus the
 * render-blocking stylesheet, the fonts `index.html` preloads, the
 * service worker's precache and the largest lazy chunk — the numbers
 * that crept up unseen before (the precache was 4.7 MB, the stats page
 * shipped 92 kB of chart library).
 *
 * The limits live in `client/perf-budget.json`, a little above what the
 * build weighs today: the point is to notice a jump, not to forbid a
 * feature. Raising one is a decision — make it in the same commit as the
 * code that needs it, with the reason in the message.
 *
 * Exit code 1 when anything is over; the table is printed either way.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const client = path.resolve(import.meta.dirname, "../client");
const dist = path.join(client, "dist");
// Limits are written in kB (1 024 bytes) — the unit the build prints.
const budgets = JSON.parse(fs.readFileSync(path.join(client, "perf-budget.json"), "utf8"));
const limit = (kb) => (kb == null ? null : kb * 1024);

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("perf-budget: no client/dist/index.html — run `pnpm build` first.");
  process.exit(2);
}

const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const local = (href) => href.replace(/^\//, "");
const bytes = (file) => fs.statSync(path.join(dist, file)).size;
const gzCache = new Map();
const gz = (file) => {
  if (!gzCache.has(file)) {
    gzCache.set(file, zlib.gzipSync(fs.readFileSync(path.join(dist, file)), { level: 9 }).length);
  }
  return gzCache.get(file);
};
const sum = (files, size) => [...new Set(files)].reduce((total, file) => total + size(file), 0);
const kB = (n) => `${(n / 1024).toFixed(1)} kB`;

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]+)"`))?.[1];
const tags = (pattern) => [...html.matchAll(pattern)].map((m) => m[0]);

const entry = tags(/<script type="module"[^>]*>/g).map((t) => attr(t, "src")).filter(Boolean).map(local);
const preloaded = tags(/<link rel="modulepreload"[^>]*>/g).map((t) => attr(t, "href")).map(local);
const css = tags(/<link rel="stylesheet"[^>]*>/g).map((t) => attr(t, "href")).filter((h) => h?.startsWith("/assets/")).map(local);
const fonts = tags(/<link rel="preload"[^>]*>/g).filter((t) => /as="font"/.test(t)).map((t) => attr(t, "href")).map(local);

// The boot preload script (`bootPreloadInjector` in vite.config.js):
// `c` maps language → catalogue chunk → file, `r` maps route → its
// files (`f`) and the catalogue chunks it needs (`t`).
const textMatch = html.match(/var c = (\{.*?\});\n/);
const routeMatch = html.match(/var r = (\{.*?\});\n/);
if (!textMatch || !routeMatch) {
  console.error("perf-budget: the boot preload table is missing from index.html (bootPreloadInjector in vite.config.js).");
  process.exit(2);
}
const text = JSON.parse(textMatch[1]).en;
const routes = Object.fromEntries(
  Object.entries(JSON.parse(routeMatch[1])).map(([route, { f, t }]) => [
    route,
    [...f.map(local), ...t.map((chunk) => local(text[chunk]))],
  ]),
);

const shell = [...entry, ...preloaded, local(text.core)];
const rows = [];
const check = (label, value, limit, format = kB) => {
  rows.push({ label, value, limit, over: limit != null && value > limit, format });
};

for (const [route, kb] of Object.entries(budgets.criticalJsGzKb)) {
  const files = routes[route];
  if (!files) {
    rows.push({ label: `critical JS ${route}`, missing: true });
    continue;
  }
  check(`critical JS ${route}`, sum([...shell, ...files], gz), limit(kb));
}
check("render-blocking CSS", sum(css, gz), limit(budgets.cssGzKb));
check("preloaded fonts", sum(fonts, bytes), limit(budgets.fontsPreloadKb));

const sw = fs.readFileSync(path.join(dist, "sw.js"), "utf8");
const precached = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => local(m[1])).filter((f) => fs.existsSync(path.join(dist, f)));
check(`precache (${precached.length} files)`, sum(precached, bytes), limit(budgets.precacheKb));

const chunks = fs.readdirSync(path.join(dist, "assets")).filter((f) => f.endsWith(".js")).map((f) => `assets/${f}`);
const largest = chunks.map((f) => [f, gz(f)]).sort((a, b) => b[1] - a[1])[0];
check(`largest chunk (${path.basename(largest[0])})`, largest[1], limit(budgets.largestChunkGzKb));

const width = Math.max(...rows.map((r) => r.label.length));
let failed = false;
for (const r of rows) {
  if (r.missing) {
    console.log(`${r.label.padEnd(width)}  —  no such route in index.html's table`);
    failed = true;
    continue;
  }
  const mark = r.over ? "OVER" : "ok";
  if (r.over) failed = true;
  console.log(`${r.label.padEnd(width)}  ${r.format(r.value).padStart(10)}  / ${r.format(r.limit).padStart(10)}  ${mark}`);
}
if (failed) {
  console.error("\nperf-budget: over budget. Shrink it, or raise the limit in client/perf-budget.json with the reason in the commit.");
  process.exit(1);
}
