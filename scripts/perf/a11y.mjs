/*
 * 触 · Lighthouse's accessibility audit (axe-core) on every page, with
 * what fails and where — the score alone does not say what to fix.
 *
 *     node a11y.mjs [paths…]
 *       FORM=desktop   1280×900 instead of a phone
 *       ANON=1         no session (the landing, sign-in, help)
 *
 * Exit code 1 when a page scores under 100, so it can gate a change.
 */
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { launch, signedInPage, targets } from "./common.mjs";

const PAGES = [
  "/dashboard", "/mangapage?mal_id=13", "/stats", "/calendrier", "/backlog", "/profile",
  "/settings", "/addmanga", "/scan", "/rangement", "/inventaire", "/seals", "/year-in-review",
  "/friends", "/snapshots", "/",
];
const urls = targets(process.argv.slice(2), process.env.ANON ? ["/", "/log-in", "/aide", "/glossary"] : PAGES);
const browser = await launch();
const page = await signedInPage(browser, { anonymous: Boolean(process.env.ANON) });
const flags = { output: "json", logLevel: "error", onlyCategories: ["accessibility"] };
let failed = false;
for (const url of urls) {
  const { lhr } = await lighthouse(url, flags, process.env.FORM === "desktop" ? desktopConfig : undefined, page);
  const score = Math.round((lhr.categories.accessibility.score ?? 0) * 100);
  const refs = lhr.categories.accessibility.auditRefs.map((r) => lhr.audits[r.id]);
  const fails = refs.filter((a) => a.score === 0);
  if (score < 100) failed = true;
  console.log(`${url.replace(/^https?:\/\/[^/]+/, "").padEnd(24)} ${String(score).padStart(3)}  ${fails.map((a) => a.id).join(" ") || "—"}`);
  for (const a of fails) {
    for (const item of (a.details?.items ?? []).slice(0, 4)) {
      const node = item.node ?? item;
      console.log(`      ${a.id}: ${(node.snippet ?? "").replace(/\s+/g, " ").slice(0, 150)}${node.explanation ? `  ⟶ ${node.explanation.split("\n")[0].slice(0, 120)}` : ""}`);
    }
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
