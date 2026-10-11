/*
 * 覆 · How much of the JavaScript a page downloads it actually runs,
 * per file — where a split or a lazy import would pay.
 *
 *     node coverage.mjs [paths…]
 */
import { launch, signedInPage, sleep, targets } from "./common.mjs";

const urls = targets(process.argv.slice(2), ["/dashboard", "/mangapage?mal_id=13", "/stats", "/settings", "/"]);
const browser = await launch();
for (const url of urls) {
  const page = await signedInPage(browser);
  await page.setViewport({ width: 1280, height: 900 });
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.goto(url, { waitUntil: "load" });
  await sleep(2500);
  await page.mouse.wheel({ deltaY: 1500 });
  await sleep(800);
  const entries = await page.coverage.stopJSCoverage();
  const rows = entries
    .filter((e) => e.url.includes("/assets/") && e.text)
    .map((e) => {
      const used = e.ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
      return {
        file: e.url.split("/").pop().replace(/-[\w-]{8}\.js$/, ".js"),
        kB: Math.round(e.text.length / 1024),
        ran: `${Math.round((used / e.text.length) * 100)} %`,
        unusedKB: Math.round((e.text.length - used) / 1024),
      };
    })
    .sort((a, b) => b.unusedKB - a.unusedKB);
  const total = rows.reduce((s, r) => s + r.kB, 0);
  const unused = rows.reduce((s, r) => s + r.unusedKB, 0);
  console.log(`\n${url}: ${rows.length} files, ${total} kB, ${Math.round(100 - (unused / Math.max(total, 1)) * 100)} % run`);
  console.table(rows.slice(0, 10));
  await page.close();
}
await browser.close();
