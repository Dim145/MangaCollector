/*
 * 跡 · One page load, traced: when the first paint and every LCP
 * candidate happened, when chosen elements entered the DOM, and what the
 * main thread did meanwhile — script, style, layout, paint, long tasks.
 *
 *     node trace.mjs /stats
 *       COLD=1        start with no device cache (IndexedDB, localStorage)
 *       CPU=4         CPU slowdown, default 4 (a mid-range phone)
 *       FORM=desktop  1280×900 instead of a 390×844 phone
 *       MARK="hero=header.washi-aged,loader=[role=status] svg"
 *                     name=selector pairs timed when they enter the DOM
 *       WINDOW=3500   ms of the trace summarised, from navigation start
 *       NET=slow4g    throttle the network for real (also: fast4g, 3g) —
 *                     what Lighthouse only models; it shows a paint that
 *                     a fast local network hides, like the boot shell's
 *
 * Observed timings on an unthrottled network: what this machine's CPU,
 * slowed down, does with the page. Lighthouse's numbers are a model of a
 * slow network on top; the two answer different questions.
 *
 * Found with it: React 19 holds a route's content back 300 ms after its
 * `<Suspense>` fallback (`lib/lazyRoute.js`), and the stats page spent
 * most of its first frame styling sections nobody could see yet.
 */
import fs from "node:fs";
import path from "node:path";
import { BASE, DESKTOP, MOBILE, OUT, launch, signedInPage, sleep, slug } from "./common.mjs";

const target = process.argv[2] || "/stats";
const url = /^https?:/.test(target) ? target : BASE + target;
const COLD = process.env.COLD === "1";
const CPU = Number(process.env.CPU || 4);
const WINDOW = Number(process.env.WINDOW || 3500);
const marks = Object.fromEntries(
  (process.env.MARK || "").split(",").filter(Boolean).map((pair) => pair.split("=")),
);

// Chrome DevTools' presets, as Puppeteer names them.
const NETWORKS = { slow4g: "Slow 4G", fast4g: "Fast 4G", "3g": "Slow 3G" };

const browser = await launch();
const page = await signedInPage(browser);
await page.setViewport(process.env.FORM === "desktop" ? DESKTOP : MOBILE);
await page.evaluateOnNewDocument((watch) => {
  window.__perf = { lcp: [], long: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const el = e.element;
        window.__perf.lcp.push({
          at: Math.round(e.startTime),
          size: e.size,
          element: el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} ${(el.textContent || "").trim().slice(0, 24) || (e.url || "").split("/").pop()}` : "?",
        });
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__perf.long.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: "longtask", buffered: true });
  } catch {
    /* an old browser — the trace still has the rest */
  }
  const seen = {};
  new MutationObserver(() => {
    for (const [name, selector] of Object.entries(watch)) {
      if (!seen[name] && document.querySelector(selector)) {
        seen[name] = true;
        performance.mark(`dom:${name}`);
      }
    }
  }).observe(document, { childList: true, subtree: true });
}, marks);

if (COLD) {
  await page.goto(`${BASE}/log-in`, { waitUntil: "load" });
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) indexedDB.deleteDatabase(db.name);
    localStorage.clear();
  });
} else {
  // Warm: one visit first, so the device cache and the service worker hold
  // what a returning reader's would.
  await page.goto(url, { waitUntil: "load" });
  await sleep(2500);
}
await page.goto("about:blank");
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
if (process.env.NET) {
  const { PredefinedNetworkConditions } = await import("puppeteer-core");
  const preset = PredefinedNetworkConditions[NETWORKS[process.env.NET]];
  if (!preset) throw new Error(`NET must be one of ${Object.keys(NETWORKS).join(", ")}`);
  await page.emulateNetworkConditions(preset);
}
await page.tracing.start({
  categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing", "loading", "v8.execute"],
});
await page.goto(url, { waitUntil: "load" });
await sleep(WINDOW);
const observed = await page.evaluate(() => ({
  fcp: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1),
  marks: performance.getEntriesByType("mark").filter((m) => m.name.startsWith("dom:")).map((m) => [m.name.slice(4), Math.round(m.startTime)]),
  lcp: window.__perf.lcp,
  long: window.__perf.long,
  nodes: document.getElementsByTagName("*").length,
}));
// A Uint8Array in recent Puppeteer, a Buffer in older ones.
const raw = Buffer.from(await page.tracing.stop());
const file = path.join(OUT, `trace-${COLD ? "cold" : "warm"}-${slug(url)}.json`);
fs.writeFileSync(file, raw);

const events = JSON.parse(raw.toString("utf8")).traceEvents;
const nav = events
  .filter((e) => e.name === "navigationStart" && e.args?.data?.isLoadingMainFrame && (e.args.data.documentLoaderURL || "").startsWith(BASE))
  .at(-1);
let summary = "no navigationStart in the trace";
if (nav) {
  const inWindow = events.filter((e) => e.pid === nav.pid && e.tid === nav.tid && e.ph === "X" && e.ts >= nav.ts && e.ts <= nav.ts + WINDOW * 1000);
  const total = (names) => Math.round(inWindow.filter((e) => names.includes(e.name)).reduce((sum, e) => sum + (e.dur || 0), 0) / 1000);
  const top = inWindow
    .filter((e) => e.name === "RunTask")
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 5)
    .map((e) => `${Math.round((e.ts - nav.ts) / 1000)} ms +${Math.round(e.dur / 1000)}`);
  summary = [
    `script ${total(["FunctionCall", "EvaluateScript", "v8.evaluateModule", "TimerFire", "FireAnimationFrame", "RunMicrotasks"])} ms`,
    `style ${total(["UpdateLayoutTree"])} ms`,
    `layout ${total(["Layout"])} ms`,
    `paint ${total(["Paint", "PrePaint", "Layerize"])} ms`,
    `longest tasks: ${top.join(", ")}`,
  ].join(" · ");
}
console.log(`${url} — ${COLD ? "cold" : "warm"}, CPU ×${CPU}${process.env.NET ? `, ${NETWORKS[process.env.NET]}` : ""}, ${observed.nodes} elements`);
console.log(`  first paint ${observed.fcp} ms; DOM: ${observed.marks.map(([n, t]) => `${n} ${t} ms`).join(", ") || "—"}`);
console.log(`  LCP candidates: ${observed.lcp.map((c) => `${c.at} ms ${c.element} (${c.size})`).join(" → ") || "—"}`);
console.log(`  long tasks: ${observed.long.map(([t, d]) => `${t}+${d}`).join(", ") || "none"}`);
console.log(`  first ${WINDOW} ms of main thread: ${summary}`);
console.log(`  trace: ${file} (chrome://tracing or the Performance panel)`);
await browser.close();
