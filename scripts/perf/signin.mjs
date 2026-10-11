/*
 * 鍵 · Sign in on the local test stack (`docs/test-stack.md`) and keep
 * the session for the other scripts.
 *
 *     node signin.mjs [username]
 *
 * The mock OpenID provider takes any username. The login button reads
 * "Continue with your account"; the header's "Sign in" is another one.
 */
import { BASE, launch, saveCookies, sleep } from "./common.mjs";

const username = process.argv[2] || "test-collector";
const browser = await launch();
const page = await browser.newPage();
await page.goto(`${BASE}/log-in`, { waitUntil: "networkidle2" });
const button = await page.waitForSelector("::-p-text(Continue with)", { timeout: 15000 });
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), button.click()]);
await page.waitForSelector("input[name=username]", { timeout: 20000 });
await page.type("input[name=username]", username);
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
  page.keyboard.press("Enter"),
]);
await sleep(1500);
const context = browser.defaultBrowserContext();
const all = typeof context.cookies === "function" ? await context.cookies() : await page.cookies();
const cookies = all.filter((c) => /localhost|127\.0\.0\.1/.test(c.domain));
saveCookies(cookies);
console.log(`signed in as ${username}: ${cookies.map((c) => c.name).join(", ") || "no cookie — is the test stack up?"}`);
await browser.close();
