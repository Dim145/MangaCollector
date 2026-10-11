/*
 * 戻 · What a reader sees between the library and a series, and while
 * flinging the library — recorded frame by frame.
 *
 *     PERF_BASE=http://localhost:12082 CHROME_BIN=… node scroll-nav.mjs \
 *         [--device phone|desktop] [--cpu 4] [--rounds 6] \
 *         [--scenario back|fling|all] [--frames] [--user test-collector]
 *
 * It signs in through the real OpenID flow (the mock provider takes any
 * username), so it runs against `pnpm preview` or a Docker stack alike.
 *
 * A sampler injected before the app samples every animation frame: the
 * scroll position, and for each library tile in the viewport its title,
 * its top, and whether its cover is painted, still fading in, not there
 * at all, or the card collapsed to nothing. Tiles are found by their
 * structure (a card button around a 2:3 cover, in a windowed row), so
 * the same script measures an older release. From that:
 *
 *   back   scroll the library to a depth, open the series under the
 *          finger, go back (the browser's back, or the page's own
 *          "Back to library"), and watch 2.5 s. Reported: the frames the
 *          library spent at a position other than the one it settled on
 *          (seen as a jump), the jumps themselves, the frames with an
 *          empty grid, with a visible tile missing its cover, with a
 *          cover fading in — and where it settled against where the
 *          reader left it (the same tiles at the same height = 0 px).
 *   fling  wheel (desktop) or swipe (phone) the library fast to the
 *          bottom and back up. Reported, per direction: frames with
 *          visible tiles missing their cover or fading in, scroll moves
 *          against the gesture, and tiles that moved in the document
 *          between two frames (content jumping under the eye).
 *
 * `--frames` also saves the screencast (JPEG per painted frame) under
 * `.out/scroll-nav/`, to look at what the numbers describe.
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
const DEVICE = opt("device", "phone");
const PHONE = DEVICE === "phone";
const CPU = Number(opt("cpu", PHONE ? 4 : 1));
const ROUNDS = Number(opt("rounds", 6));
const SCENARIO = opt("scenario", "all");
const FRAMES = Boolean(opt("frames", false));
const USER = opt("user", "test-collector");
const FRAME_DIR = path.join(OUT, "scroll-nav");

/** Runs in the page, before the app: one sample per animation frame. */
function sampler() {
  const mc = (window.__mc = { on: false, frames: [], shifts: [] });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!mc.on) continue;
        mc.shifts.push({
          t: e.startTime,
          v: e.value,
          src: (e.sources || []).slice(0, 2).map((s) => {
            const n = s.node;
            if (!n || !n.getAttribute) return "?";
            const title = n.closest?.("button")?.querySelector(".line-clamp-2")?.textContent;
            return title ? `tile "${title.trim().slice(0, 24)}"` : `${n.nodeName}.${String(n.className || "").split(" ")[0]}`;
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: false });
  } catch {
    /* no layout-shift entries in this browser */
  }
  // A library tile: a card button holding a 2:3 cover, inside one of the
  // windowed grid's rows (`data-index`). Keyed by its title, which works
  // on every version of the page (the list semantics came later).
  const tiles = () => {
    const out = [];
    const vh = innerHeight;
    for (const cover of document.querySelectorAll('button > div[class*="aspect-[2/3]"]')) {
      const btn = cover.parentElement;
      if (!btn.closest("[data-index]")) continue;
      const r = btn.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh) continue;
      const img = cover.querySelector("img");
      // 0 painted · 1 fading in · 2 no cover yet · 3 collapsed card
      let state = 2;
      if (cover.offsetWidth < 20) state = 3;
      else if (img && img.complete && img.naturalWidth > 0) {
        state = Number.parseFloat(getComputedStyle(img).opacity) >= 0.99 ? 0 : 1;
      }
      const key = btn.querySelector(".line-clamp-2")?.textContent?.trim() || "?";
      out.push([key, Math.round(r.top), state]);
    }
    return out;
  };
  // Sampled after the frame, not inside it: a callback registered
  // before the app's own would read the page before the app moved it
  // in that very frame. A message posted from the frame's callback is
  // handled once the frame has been rendered.
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    if (!mc.on) return;
    const grid = document.querySelector("[data-index]")?.parentElement;
    mc.frames.push({
      t: performance.now(),
      p: location.pathname,
      y: Math.round(scrollY),
      h: document.documentElement.scrollHeight,
      g: grid ? grid.offsetHeight : 0,
      w: grid ? grid.offsetWidth : 0,
      r: grid?.firstElementChild ? grid.firstElementChild.offsetHeight : 0,
      n: grid ? grid.querySelectorAll('button > div[class*="aspect-[2/3]"]').length : 0,
      tiles: tiles(),
    });
  };
  const tick = () => {
    if (mc.on) channel.port2.postMessage(0);
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

// ── Signing in through the provider, like a reader.
await signInThroughProvider(page, BASE, USER);
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector('[data-index] button > div[class*="aspect-[2/3]"]', { timeout: 20000 });
await sleep(1500);

const vp = PHONE ? MOBILE : DESKTOP;

/** Scrolls by `dy` (positive = down) the way this device does it. */
async function scrollBy(dy, { fast = false } = {}) {
  if (PHONE) {
    await cdp.send("Input.synthesizeScrollGesture", {
      x: Math.round(vp.width / 2),
      y: Math.round(vp.height / 2),
      yDistance: -dy,
      speed: fast ? 9000 : 2500,
      gestureSourceType: "touch",
      repeatCount: 1,
    });
    return;
  }
  await page.mouse.move(vp.width / 2, vp.height / 2);
  const step = fast ? 450 : 200;
  const pause = fast ? 16 : 60;
  for (let left = Math.abs(dy); left > 0; left -= step) {
    await page.mouse.wheel({ deltaY: Math.sign(dy) * Math.min(step, left) });
    await sleep(pause);
  }
}

async function tapOrClick(x, y) {
  if (PHONE) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

const visibleTiles = () =>
  page.evaluate(() => {
    const out = [];
    for (const cover of document.querySelectorAll('button > div[class*="aspect-[2/3]"]')) {
      const btn = cover.parentElement;
      if (!btn.closest("[data-index]")) continue;
      const r = btn.getBoundingClientRect();
      if (r.height < 20 || r.bottom <= 0 || r.top >= innerHeight) continue;
      out.push({
        n: btn.querySelector(".line-clamp-2")?.textContent?.trim() || "?",
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
      });
    }
    return { y: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight, tiles: out };
  });

async function record(fn, ms) {
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
    window.__mc.frames.length = 0;
    window.__mc.shifts.length = 0;
    window.__mc.on = true;
  });
  const t0 = await page.evaluate(() => performance.now());
  await fn();
  await sleep(ms);
  const data = await page.evaluate(() => {
    window.__mc.on = false;
    return { frames: window.__mc.frames.slice(), shifts: window.__mc.shifts.slice() };
  });
  if (shots) {
    await cdp.send("Page.stopScreencast");
    cdp.removeAllListeners("Page.screencastFrame");
  }
  return { t0, ...data, shots };
}

function saveShots(shots, name) {
  if (!shots?.length) return;
  const dir = path.join(FRAME_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const start = shots[0].at;
  for (const s of shots) {
    const ms = String(Math.round((s.at - start) * 1000)).padStart(5, "0");
    fs.writeFileSync(path.join(dir, `${ms}.jpg`), Buffer.from(s.data, "base64"));
  }
}

const ms = (frames) => (frames.length < 2 ? 0 : Math.round(frames.at(-1).t - frames[0].t));

/** What the library looked like on its way back. */
function analyseBack(rec, before) {
  const dash = rec.frames.filter((f) => f.p === "/dashboard");
  if (!dash.length) return { error: "never came back" };
  const last = dash.at(-1);
  const away = dash.filter((f) => Math.abs(f.y - last.y) > 2);
  let jumps = 0;
  for (let i = 1; i < dash.length; i += 1) if (Math.abs(dash[i].y - dash[i - 1].y) > 2) jumps += 1;
  const empty = dash.filter((f) => f.tiles.length === 0);
  const blank = dash.filter((f) => f.tiles.some((t) => t[2] >= 2));
  const collapsed = dash.filter((f) => f.tiles.some((t) => t[2] === 3));
  const fading = dash.filter((f) => f.tiles.some((t) => t[2] === 1));
  // Settled: the last frame where the position, a tile's place or a
  // cover's state still changed.
  let settled = dash[0];
  for (let i = 1; i < dash.length; i += 1) {
    const a = dash[i - 1];
    const b = dash[i];
    const sig = (f) => `${f.y}|${f.tiles.map((t) => t.join(":")).join(",")}`;
    if (sig(a) !== sig(b)) settled = b;
  }
  // Where it settled: the tiles the reader had in view, where are they now?
  const now = new Map(last.tiles.map((t) => [t[0], t[1]]));
  const deltas = before.tiles.filter((t) => now.has(t.n)).map((t) => now.get(t.n) - t.top);
  deltas.sort((a, b) => a - b);
  const anchor = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
  return {
    frames: dash.length,
    awayFrames: away.length,
    awayMs: ms(away),
    jumps,
    emptyFrames: empty.length,
    blankFrames: blank.length,
    collapsedFrames: collapsed.length,
    fadingFrames: fading.length,
    settleMs: Math.round(settled.t - dash[0].t),
    anchorPx: anchor,
    commonTiles: deltas.length,
    leftY: before.y,
    backY: last.y,
    shifts: rec.shifts.length,
    timeline: rec.frames.map((f) => [
      Math.round(f.t - rec.t0),
      f.p === "/dashboard" ? "D" : "S",
      f.y,
      f.h,
      f.g,
      f.n,
      f.tiles.length,
      f.tiles.filter((t) => t[2] >= 2).length,
      f.tiles.filter((t) => t[2] === 1).length,
      f.w,
      f.r,
    ]),
  };
}

/** What a fast scroll looked like, one direction at a time. */
function analyseFling(frames, from, to) {
  const part = frames.filter((f) => f.t >= from && f.t <= to && f.p === "/dashboard");
  let against = 0;
  let moved = 0;
  const dir = Math.sign((part.at(-1)?.y ?? 0) - (part[0]?.y ?? 0));
  for (let i = 1; i < part.length; i += 1) {
    const dy = part[i].y - part[i - 1].y;
    if (dir !== 0 && Math.sign(dy) === -dir && Math.abs(dy) > 2) against += 1;
    // A tile's place in the document must not change while scrolling.
    const prev = new Map(part[i - 1].tiles.map((t) => [t[0], t[1] + part[i - 1].y]));
    if (part[i].tiles.some((t) => prev.has(t[0]) && Math.abs(prev.get(t[0]) - (t[1] + part[i].y)) > 1)) moved += 1;
  }
  return {
    frames: part.length,
    blankFrames: part.filter((f) => f.tiles.some((t) => t[2] >= 2)).length,
    collapsedFrames: part.filter((f) => f.tiles.some((t) => t[2] === 3)).length,
    maxBlankTiles: Math.max(0, ...part.map((f) => f.tiles.filter((t) => t[2] >= 2).length)),
    fadingFrames: part.filter((f) => f.tiles.some((t) => t[2] === 1)).length,
    emptyFrames: part.filter((f) => f.tiles.length === 0).length,
    againstGesture: against,
    contentJumps: moved,
  };
}

const report = { base: BASE, device: DEVICE, cpu: CPU, back: [], fling: [] };

// ── Warm-up: once down and up the whole shelf, so covers are cached as
// they would be for a reader who has been browsing.
{
  const { max } = await visibleTiles();
  await scrollBy(max, { fast: false });
  await sleep(800);
  await scrollBy(-max, { fast: false });
  await sleep(800);
}

if (SCENARIO === "all" || SCENARIO === "back") {
  const depths = [0.25, 0.45, 0.65, 0.85, 0.35, 0.75, 0.55, 0.95];
  for (let round = 0; round < ROUNDS; round += 1) {
    const via = round % 2 === 0 ? "browser" : "link";
    const scrolledSeries = via === "browser" && round % 4 === 0;
    // Back on the library, at the top, every round.
    if (!(await page.evaluate(() => location.pathname === "/dashboard"))) {
      await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2" });
    }
    const { y, max } = await visibleTiles();
    const goal = Math.round(max * depths[round % depths.length]);
    await scrollBy(goal - y);
    await sleep(1200);
    const before = await visibleTiles();
    const pick = before.tiles.filter((t) => t.top > 120 && t.bottom < vp.height - 120);
    const target = pick[Math.floor(pick.length / 2)] ?? before.tiles[0];
    if (!target) {
      console.log(`back #${round}: no tile in view at y=${before.y} (max ${before.max}) — skipped`);
      report.back.push({ round, error: "no tile in view", y: before.y, max: before.max });
      continue;
    }
    await tapOrClick(target.x, target.y);
    await page.waitForFunction(() => location.pathname === "/mangapage", { timeout: 15000 });
    await sleep(1500);
    if (scrolledSeries) {
      await scrollBy(900);
      await sleep(600);
    }
    const rec = await record(async () => {
      if (via === "browser") {
        await page.evaluate(() => history.back());
      } else {
        const at = await page.evaluate(() => {
          const b = [...document.querySelectorAll("button")].find((el) => el.textContent.trim().startsWith("←"));
          if (!b) return null;
          b.scrollIntoView({ block: "center", behavior: "instant" });
          const r = b.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        if (at) await tapOrClick(at.x, at.y);
        else await page.evaluate(() => history.back());
      }
    }, 2500);
    const result = { round, via, scrolledSeries, opened: target.n, ...analyseBack(rec, before) };
    report.back.push(result);
    saveShots(rec.shots, `back-${DEVICE}-${round}-${via}`);
    console.log(
      `back #${round} ${via}${scrolledSeries ? "+scrolled" : ""} tile ${target.n}: ` +
        `away ${result.awayFrames}f/${result.awayMs}ms, jumps ${result.jumps}, empty ${result.emptyFrames}f, ` +
        `no-cover ${result.blankFrames}f (collapsed ${result.collapsedFrames}f), fading ${result.fadingFrames}f, settled ${result.settleMs}ms, ` +
        `anchor ${result.anchorPx}px (${result.commonTiles} tiles), y ${result.leftY}→${result.backY}`,
    );
  }
}

if (SCENARIO === "all" || SCENARIO === "fling") {
  for (let round = 0; round < Math.max(2, Math.ceil(ROUNDS / 3)); round += 1) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(800);
    const { max } = await visibleTiles();
    let mid = 0;
    const rec = await record(async () => {
      await scrollBy(max, { fast: true });
      await sleep(400);
      mid = await page.evaluate(() => performance.now());
      await scrollBy(-max, { fast: true });
    }, 800);
    const down = analyseFling(rec.frames, 0, mid);
    const up = analyseFling(rec.frames, mid, Number.POSITIVE_INFINITY);
    report.fling.push({ round, down, up, shifts: rec.shifts });
    saveShots(rec.shots, `fling-${DEVICE}-${round}`);
    for (const [name, r] of [["down", down], ["up", up]]) {
      console.log(
        `fling #${round} ${name}: ${r.frames}f, no-cover ${r.blankFrames}f (max ${r.maxBlankTiles} tiles, collapsed ${r.collapsedFrames}f), ` +
          `fading ${r.fadingFrames}f, empty ${r.emptyFrames}f, against-gesture ${r.againstGesture}, content-jumps ${r.contentJumps}`,
      );
    }
  }
}

fs.writeFileSync(path.join(OUT, `scroll-nav-${DEVICE}.json`), JSON.stringify(report, null, 2));
console.log(`\n→ ${path.join(OUT, `scroll-nav-${DEVICE}.json`)}`);
await browser.close();
