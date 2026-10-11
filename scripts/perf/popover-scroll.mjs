/*
 * 錨 · Whether a menu stays put while the page scrolls under it —
 * recorded on the painted frames, not measured from script.
 *
 *     PERF_BASE=http://localhost:12082 CHROME_BIN=… node popover-scroll.mjs [--device desktop|phone]
 *
 * Two runs on the account menu (anchored to the header, which is
 * sticky): opened at the top of the library and scrolled down slowly,
 * then opened at the foot of the profile page and scrolled up fast. A
 * menu anchored to a button that does not move with the page must not
 * move either. The panel gets a bright outline for the length of the
 * run, its top edge is found on every screencast frame, and the report
 * gives how far it strayed from where it was opened.
 *
 * Read on the frames because the drift lives in the compositor: a
 * position read from script forces the layout that puts it back.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { BASE, DESKTOP, MOBILE, OUT, launch, signInThroughProvider, sleep } from "./common.mjs";

const args = process.argv.slice(2);
const DEVICE = args.includes("--device") ? args[args.indexOf("--device") + 1] : "desktop";
const PHONE = DEVICE === "phone";
const DIR = path.join(OUT, "popover-scroll");

const browser = await launch();
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport(PHONE ? MOBILE : DESKTOP);
const cdp = await page.createCDPSession();
await signInThroughProvider(page);

const vp = PHONE ? MOBILE : DESKTOP;

async function scroll(dy, { fast }) {
  if (PHONE) {
    await cdp.send("Input.synthesizeScrollGesture", {
      x: Math.round(vp.width / 2), y: Math.round(vp.height * 0.7),
      yDistance: -dy, speed: fast ? 6000 : 600, gestureSourceType: "touch",
    });
    return;
  }
  await page.mouse.move(vp.width / 2, vp.height * 0.7);
  const step = fast ? 400 : 60;
  for (let left = Math.abs(dy); left > 0; left -= step) {
    await page.mouse.wheel({ deltaY: Math.sign(dy) * Math.min(step, left) });
    await sleep(fast ? 16 : 70);
  }
}

async function run(name, path_, startAt, dy, fast) {
  await page.goto(`${BASE}${path_}`, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(1200);
  await page.evaluate((y) => window.scrollTo({ top: y === "bottom" ? document.documentElement.scrollHeight : y, behavior: "instant" }), startAt);
  await sleep(600);
  // The bright outline that makes the panel findable on a frame.
  await page.addStyleTag({ content: "[role=menu]{outline:4px solid rgb(0,255,0)!important;outline-offset:0!important}" });
  const button = await page.$('button[aria-haspopup="menu"]');
  const box = await button.boundingBox();
  if (PHONE) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector("[role=menu]", { visible: true });
  await sleep(500);
  const placed = await page.evaluate(() => {
    const menu = document.querySelector("[role=menu]");
    const btn = document.querySelector('button[aria-haspopup="menu"]');
    const m = menu.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    return {
      anchored: menu.style.getPropertyValue("position-anchor") !== "",
      gapBelowButton: Math.round(m.top - b.bottom),
      rightEdgeOffset: Math.round(b.right - m.right),
    };
  });
  console.log(`${DEVICE} ${name}: opened ${placed.anchored ? "by anchor" : "from the button's rectangle"}, ${placed.gapBelowButton}px below it, right edges ${placed.rightEdgeOffset}px apart`);
  if (name === "top-slow-down") {
    await page.screenshot({ path: path.join(OUT, `popover-scroll-${DEVICE}-open.png`), clip: { x: vp.width / 2, y: 0, width: vp.width / 2, height: Math.min(vp.height, 520) } });
  }
  const dir = path.join(DIR, `${DEVICE}-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let start = null;
  cdp.on("Page.screencastFrame", async (f) => {
    start ??= f.metadata.timestamp;
    fs.writeFileSync(path.join(dir, `${String(Math.round((f.metadata.timestamp - start) * 1000)).padStart(5, "0")}.jpg`), Buffer.from(f.data, "base64"));
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });
  await sleep(300);
  await scroll(dy, { fast });
  await sleep(700);
  await cdp.send("Page.stopScreencast");
  cdp.removeAllListeners("Page.screencastFrame");
  // Find the outline on each frame (a small Python reader: PIL is here, no image library in Node).
  const out = execFileSync("python3", ["-I", "-c", READER, dir], { encoding: "utf8" });
  const tops = JSON.parse(out);
  const values = tops.map((t) => t[1]).filter((v) => v != null);
  const rest = values[0];
  const worst = Math.max(...values.map((v) => Math.abs(v - rest)));
  console.log(`${DEVICE} ${name}: menu top ${rest}px when opened, strayed up to ${worst}px over ${values.length} frames — ${tops.slice(0, 24).map((t) => t[1]).join(" ")}`);
  await page.keyboard.press("Escape");
}

// Top edge of the green outline, per frame (in CSS pixels).
const READER = `
import json, os, sys
from PIL import Image
d = sys.argv[1]
res = []
for f in sorted(x for x in os.listdir(d) if x.endswith(".jpg")):
    im = Image.open(os.path.join(d, f)).convert("RGB")
    w, h = im.size
    px = im.load()
    top = None
    for y in range(h):
        hits = 0
        for x in range(w // 2, w, 2):
            r, g, b = px[x, y]
            if g > 180 and r < 110 and b < 110:
                hits += 1
                if hits > 12:
                    break
        if hits > 12:
            top = y
            break
    res.append([int(f[:-4]), top])
print(json.dumps(res))
`;

await run("top-slow-down", "/dashboard", 0, 700, false);
await run("bottom-fast-up", "/profile", "bottom", -1600, true);
await browser.close();
