/*
 * 開 · How a panel arrives — the volume drawer (a tome's "Edit", an
 * announced tome's details) and, on a phone, the library's filter sheet
 * — recorded frame by frame.
 *
 *     PERF_BASE=http://localhost:12082 CHROME_BIN=… node overlay-open.mjs \
 *         [--device desktop|phone] [--cpu N] [--series "One Piece"] [--frames]
 *
 * A panel sliding in travels one way and stops: its leading edge moves
 * monotonically to where it rests. Reported per opening: how far it
 * went past its resting place, how many frames it moved backwards, and
 * how far the dialog around it was scrolled — a `<dialog>` scrolls by
 * default, and focus given to a panel still off-screen scrolls it to
 * show it, which reads as the panel overshooting and coming back.
 *
 * Finds the panel by its animation class and the dialog as `<dialog>`
 * or `[role=dialog]`, so an older release can be measured the same way.
 */
import fs from "node:fs";
import path from "node:path";
import { BASE, DESKTOP, MOBILE, OUT, launch, signInThroughProvider, sleep } from "./common.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith("--") ? next : true;
};
const DEVICE = opt("device", "desktop");
const PHONE = DEVICE === "phone";
const CPU = Number(opt("cpu", PHONE ? 4 : 1));
const SERIES = opt("series", "One Piece");
const FRAMES = Boolean(opt("frames", false));
const FRAME_DIR = path.join(OUT, "overlay-open");

const EDIT = ["Edit", "Modifier", "Editar"];
const UPCOMING = ["View upcoming-volume details", "Voir les détails du tome à venir", "Ver los detalles del tomo por venir"];
const FILTERS = ["Filters", "Filtres", "Filtros"];

/** In the page, before the app: the moving panel, sampled after each frame. */
function sampler() {
  const ov = (window.__ov = { on: false, frames: [] });
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    if (!ov.on) return;
    const panel = document.querySelector(
      ".animate-drawer-in, .animate-drawer-out, .animate-sheet-in, .animate-sheet-out",
    );
    if (!panel) {
      ov.frames.push({ t: performance.now(), none: true });
      return;
    }
    const box = panel.closest("dialog, [role=dialog]");
    const r = panel.getBoundingClientRect();
    ov.frames.push({
      t: performance.now(),
      left: r.left,
      top: r.top,
      sx: box ? box.scrollLeft : 0,
      sy: box ? box.scrollTop : 0,
    });
  };
  const tick = () => {
    if (ov.on) channel.port2.postMessage(0);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const browser = await launch();
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.setViewport(PHONE ? MOBILE : DESKTOP);
await page.evaluateOnNewDocument(sampler);
const cdp = await page.createCDPSession();
if (CPU > 1) await page.emulateCPUThrottling(CPU);
await signInThroughProvider(page);

async function clickAt({ x, y }) {
  if (PHONE) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/**
 * The centre of the first element matching, brought into view — looked
 * for down the page when a windowed grid has not rendered it yet (an
 * announced tome sits at the end of a long series).
 */
async function locate(selector, labels, { search = false } = {}) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  for (let step = 0; step < (search ? 60 : 1); step += 1) {
    const at = await page.evaluate(
      (sel, names) => {
        // The visible one: a phone and a desktop control can share a name.
        const el = [...document.querySelectorAll(sel)].find(
          (node) =>
            node.getClientRects().length > 0 &&
            names.some((n) => (node.getAttribute("aria-label") || node.textContent || "").trim().includes(n)),
        );
        if (!el) return null;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      selector,
      labels,
    );
    if (at) return at;
    await page.evaluate(() => window.scrollBy({ top: innerHeight * 0.8, behavior: "instant" }));
    await sleep(120);
  }
  return null;
}

async function record(name, open, ms = 900) {
  let shots = null;
  if (FRAMES) {
    shots = [];
    cdp.on("Page.screencastFrame", async (f) => {
      shots.push({ at: f.metadata.timestamp, data: f.data });
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, everyNthFrame: 1 });
  }
  await page.evaluate(() => {
    window.__ov.frames.length = 0;
    window.__ov.on = true;
  });
  await open();
  await sleep(ms);
  const frames = await page.evaluate(() => {
    window.__ov.on = false;
    return window.__ov.frames.slice();
  });
  if (shots) {
    await cdp.send("Page.stopScreencast");
    cdp.removeAllListeners("Page.screencastFrame");
    const dir = path.join(FRAME_DIR, `${DEVICE}-${name}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const start = shots[0]?.at ?? 0;
    for (const s of shots) {
      fs.writeFileSync(path.join(dir, `${String(Math.round((s.at - start) * 1000)).padStart(5, "0")}.jpg`), Buffer.from(s.data, "base64"));
    }
  }
  return frames;
}

/** One opening: from where it comes, the edge that leads it. */
function analyse(frames, axis) {
  const seen = frames.filter((f) => !f.none);
  if (!seen.length) return { error: "no panel" };
  const edge = (f) => (axis === "x" ? f.left : f.top);
  const rest = edge(seen.at(-1));
  let past = 0;
  let backwards = 0;
  for (let i = 0; i < seen.length; i += 1) {
    past = Math.max(past, rest - edge(seen[i]));
    if (i > 0 && edge(seen[i]) - edge(seen[i - 1]) > 1) backwards += 1;
  }
  return {
    frames: seen.length,
    overshootPx: Math.round(past),
    backwardsFrames: backwards,
    maxDialogScroll: Math.round(Math.max(...seen.map((f) => Math.max(Math.abs(f.sx), Math.abs(f.sy))))),
    path: seen.slice(0, 14).map((f) => Math.round(edge(f))).join(" → "),
  };
}

const results = [];
const report = (name, r) => {
  results.push({ name, ...r });
  console.log(
    `${name}: ${r.error ?? `went ${r.overshootPx} px past its place, ${r.backwardsFrames} frame(s) backwards, dialog scrolled up to ${r.maxDialogScroll} px — ${r.path}`}`,
  );
};

// ── The series page, reached the way a reader reaches it.
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector('[data-index] button > div[class*="aspect-[2/3]"]', { timeout: 20000 });
await page.type('input[type="search"], main input[placeholder]', SERIES);
await sleep(900);
const tile = await page.evaluate((title) => {
  // Two series can share a title (a custom one beside MyAnimeList's):
  // the longest run is the one with an announced tome at its end.
  const total = (b) => Number(/\/\s*(\d+)/.exec(b.textContent)?.[1] ?? 0);
  const btn = [...document.querySelectorAll("button")]
    .filter((b) => b.querySelector(".line-clamp-2")?.textContent?.trim() === title)
    .sort((a, b) => total(b) - total(a))[0];
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, SERIES);
if (!tile) {
  console.error(`No "${SERIES}" on the shelf.`);
  process.exit(1);
}
await clickAt(tile);
await page.waitForFunction(() => location.pathname === "/mangapage", { timeout: 15000 });
await sleep(1800);

for (const [name, labels] of [["edit", EDIT], ["upcoming", UPCOMING]]) {
  const at = await locate("button[aria-label]", labels, { search: true });
  if (!at) {
    console.log(`${name}: no such button on this series`);
    continue;
  }
  await sleep(400);
  report(name, analyse(await record(name, () => clickAt(at)), "x"));
  await page.keyboard.press("Escape");
  await sleep(700);
}

if (PHONE) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2" });
  await sleep(1200);
  const at = await locate("button[aria-haspopup=dialog]", FILTERS);
  if (at) {
    await sleep(400);
    // The sheet's module loads on first use: give it the time to arrive.
    report("filters-sheet", analyse(await record("filters-sheet", () => clickAt(at), 1800), "y"));
    await page.keyboard.press("Escape");
  } else {
    console.log("filters-sheet: no sheet button (an older release)");
  }
}

fs.writeFileSync(path.join(OUT, `overlay-open-${DEVICE}.json`), JSON.stringify({ base: BASE, device: DEVICE, cpu: CPU, results }, null, 2));
await browser.close();
