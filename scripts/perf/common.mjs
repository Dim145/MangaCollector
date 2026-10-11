/*
 * 測 · What the measurement scripts share: where the app is, where the
 * browser is, where results go, and a signed-in browser.
 *
 *   PERF_BASE   the app, default http://localhost:4173 (`pnpm preview`)
 *   CHROME_BIN  a Chromium to drive (required): Chrome, or the headless
 *               shell Playwright caches under ~/Library/Caches/ms-playwright
 *   PERF_OUT    where reports go, default scripts/perf/.out (git-ignored)
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

export const BASE = (process.env.PERF_BASE || "http://localhost:4173").replace(/\/$/, "");
export const OUT = process.env.PERF_OUT || path.join(import.meta.dirname, ".out");
fs.mkdirSync(OUT, { recursive: true });

export const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1 };

export function chromePath() {
  const bin = process.env.CHROME_BIN;
  if (!bin || !fs.existsSync(bin)) {
    console.error("Set CHROME_BIN to a Chromium executable (see scripts/perf/README.md).");
    process.exit(2);
  }
  return bin;
}

export function launch() {
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    pipe: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

const COOKIES = path.join(OUT, "cookies.json");

/** The session `signin.mjs` saved, for `page.setCookie` / Lighthouse. */
export function savedCookies() {
  if (!fs.existsSync(COOKIES)) return [];
  return JSON.parse(fs.readFileSync(COOKIES, "utf8"));
}

export function saveCookies(cookies) {
  fs.writeFileSync(COOKIES, JSON.stringify(cookies, null, 2));
}

/** A page carrying the saved session (unless `anonymous`). */
export async function signedInPage(browser, { anonymous = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const cookies = anonymous ? [] : savedCookies();
  if (cookies.length) {
    if (typeof context.setCookie === "function") await context.setCookie(...cookies);
    else await page.setCookie(...cookies);
  }
  return page;
}

export const slug = (url) => url.replace(/^https?:\/\/[^/]+/, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Paths from argv, or a default list; full URLs pass through. */
export function targets(argv, fallback) {
  const list = argv.length ? argv : fallback;
  return list.map((p) => (/^https?:/.test(p) ? p : BASE + p));
}

/**
 * 鍵 · Signs a page in through the provider, as a reader would: the
 * app's own `/auth/oauth2`, the mock's form, back to the app. Works
 * against the preview and a Docker stack alike (`signin.mjs` saves
 * cookies for the other scripts instead).
 */
export async function signInThroughProvider(page, base = BASE, user = "test-collector") {
  await page.goto(`${base}/auth/oauth2`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[name=username]", { timeout: 20000 });
  await page.type("input[name=username]", user);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
    page.keyboard.press("Enter"),
  ]);
}

