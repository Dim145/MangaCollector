/*
 * 灯 · Lighthouse, several runs per page, the median kept.
 *
 *     node lighthouse.mjs [paths…]
 *       FORM=mobile|desktop   default mobile (Lighthouse's simulated slow 4G, CPU ×4)
 *       COLD=1                clear IndexedDB and localStorage first (no device cache)
 *       ANON=1                no session
 *       RUNS=3                runs per page
 *
 * Simulated timings move with bytes more than with anything else: a run
 * where the dashboard's MangaDex covers load in the window reports an LCP
 * near 8 s, one where they do not, near 5 s — the cover is the LCP element
 * and a `.512` MangaDex thumbnail weighs 115–252 kB. Read the `bytes`
 * column before comparing two runs, and prefer the median of several.
 */
import fs from "node:fs";
import path from "node:path";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { OUT, launch, signedInPage, slug, targets } from "./common.mjs";

const FORM = process.env.FORM || "mobile";
const COLD = process.env.COLD === "1";
const RUNS = Number(process.env.RUNS || 3);
const TAG = process.env.TAG || `${FORM}${COLD ? "-cold" : "-warm"}${process.env.ANON ? "-anon" : ""}`;
const urls = targets(process.argv.slice(2), ["/dashboard", "/mangapage?mal_id=13", "/stats", "/settings", "/"]);

const clear = ["file_systems", "shader_cache", "service_workers", "cache_storage"];
if (COLD) clear.push("indexeddb", "local_storage");
const flags = { output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices"], clearStorageTypes: clear };
const config = FORM === "desktop" ? desktopConfig : undefined;

const browser = await launch();
const page = await signedInPage(browser, { anonymous: Boolean(process.env.ANON) });
const num = (lhr, id) => lhr.audits[id]?.numericValue;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows = [];

for (const url of urls) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    let lhr;
    try {
      ({ lhr } = await lighthouse(url, flags, config, page));
    } catch (error) {
      console.log("lighthouse failed", url, error.message.split("\n")[0]);
      continue;
    }
    fs.writeFileSync(path.join(OUT, `lhr-${TAG}-${slug(url)}-${i + 1}.json`), JSON.stringify(lhr));
    const run = {
      perf: Math.round((lhr.categories.performance?.score ?? 0) * 100),
      FCP: Math.round(num(lhr, "first-contentful-paint") ?? -1),
      LCP: Math.round(num(lhr, "largest-contentful-paint") ?? -1),
      TBT: Math.round(num(lhr, "total-blocking-time") ?? -1),
      CLS: +(num(lhr, "cumulative-layout-shift") ?? -1).toFixed(3),
      bytes: Math.round((num(lhr, "total-byte-weight") ?? 0) / 1024),
      bootup: Math.round(num(lhr, "bootup-time") ?? -1),
    };
    runs.push(run);
    console.log(`${url.replace(/^https?:\/\/[^/]+/, "").padEnd(24)} run ${i + 1}: ${JSON.stringify(run)}`);
  }
  if (!runs.length) continue;
  const row = { url: url.replace(/^https?:\/\/[^/]+/, "") };
  for (const key of Object.keys(runs[0])) row[key] = median(runs.map((r) => r[key]));
  rows.push(row);
}
console.log(`\nmedians (${TAG}, ${RUNS} runs):`);
console.table(rows);
fs.writeFileSync(path.join(OUT, `summary-${TAG}.json`), JSON.stringify(rows, null, 2));
await browser.close();
