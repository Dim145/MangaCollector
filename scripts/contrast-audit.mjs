#!/usr/bin/env node
/**
 * 対比 · WCAG contrast audit of the theme tokens, as they are actually
 * used in the components.
 *
 * Reads the palette out of `client/src/styles/index.css` (`:root`, the
 * light override and every `[data-accent]` block), then walks the JSX for
 * `text-…` / `bg-…` utilities — opacity modifiers included — and reports
 * every foreground/surface pair whose ratio falls under the threshold for
 * the text size it is used at.
 *
 *   node scripts/contrast-audit.mjs           # failures only
 *   node scripts/contrast-audit.mjs --all     # every pair
 *   node scripts/contrast-audit.mjs --json
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CSS = join(ROOT, "client/src/styles/index.css");
const SRC = join(ROOT, "client/src");

/* ─── colour maths ─────────────────────────────────────────────────── */
function oklchToLinear(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
}
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function ratio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** `color-mix`-free approximation of Tailwind's `/NN` alpha over a surface. */
const over = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

/* ─── palette ──────────────────────────────────────────────────────── */
const css = readFileSync(CSS, "utf8");
const OKLCH = /--([a-z0-9-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/g;

function blockOf(selector) {
  const i = css.indexOf(selector + " {");
  if (i < 0) return null;
  const start = css.indexOf("{", i);
  let depth = 0;
  for (let j = start; j < css.length; j++) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}" && --depth === 0) return css.slice(start, j);
  }
  return null;
}
/** `--on-hanko` points at another token rather than a colour of its own. */
function resolveOnHanko(selector, palette, base) {
  const block = blockOf(selector);
  const m = block && block.match(/--on-hanko:\s*var\(--([a-z0-9-]+)\)/);
  const token = m ? m[1] : null;
  return token && palette[token] ? palette[token] : base["on-hanko-resolved"] ?? null;
}

function paletteOf(selector, base = {}) {
  const block = blockOf(selector);
  const out = { ...base };
  if (!block) return out;
  for (const m of block.matchAll(OKLCH)) {
    if (m[5] !== undefined) continue; // tokens with baked-in alpha are glows
    out[m[1]] = oklchToLinear(+m[2], +m[3], +m[4]);
  }
  out["on-hanko-resolved"] = resolveOnHanko(selector, out, base);
  return out;
}
const dark = paletteOf(":root");
const light = paletteOf(':root[data-theme="light"]', dark);
const accents = [...css.matchAll(/:root\[data-accent="([a-z]+)"\]/g)].map((m) => m[1]);

/* ─── how the components use them ──────────────────────────────────── */
const FILES = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.jsx?$/.test(name) && !/\.test\./.test(name)) FILES.push(p);
  }
})(SRC);

const SURFACES = ["ink-0", "ink-1", "ink-2", "ink-3"];
const TEXT =
  /\btext-(washi-muted|washi-dim|washi|gold-muted|gold|hanko-bright|hanko-deep|hanko|on-hanko|moegi-muted|moegi|success|danger)(?![\w-])(?:\/(\d{1,3}))?/g;
/** Tailwind size utilities that stay "normal text" for WCAG (< 18.66px bold / 24px). */
const SIZE = /\btext-\[(\d+)px\]/;

const uses = new Map(); // `${token}/${alpha}` → {token, alpha, files:Set, small:boolean}
for (const file of FILES) {
  const body = readFileSync(file, "utf8");
  for (const line of body.split("\n")) {
    for (const m of line.matchAll(TEXT)) {
      const alpha = m[2] ? Math.min(100, +m[2]) / 100 : 1;
      const key = `${m[1]}/${alpha}`;
      if (!uses.has(key))
        uses.set(key, { token: m[1], alpha, files: new Set(), px: new Set() });
      const u = uses.get(key);
      u.files.add(file.slice(ROOT.length));
      const size = line.match(SIZE);
      if (size) u.px.add(+size[1]);
    }
  }
}

/* ─── what counts as a failure ─────────────────────────────────────── */
/**
 * Text at 15 % opacity is not text: those are the giant kanji
 * watermarks behind headings, `aria-hidden` by construction. WCAG
 * exempts incidental and decorative content, so they are listed
 * apart instead of drowning the real findings.
 */
const DECORATIVE_ALPHA = 0.5;

/**
 * Pairs that fall short and stay that way on purpose, each with the
 * reason. They are printed, never silently dropped — an exception you
 * cannot see is an exception you cannot revisit.
 */
const ACCEPTED = [];
const acceptedOf = (r) =>
  ACCEPTED.find(
    (a) => a.theme === r.theme && a.token === r.token && a.surface === r.surface,
  );

/* ─── report ───────────────────────────────────────────────────────── */
const args = new Set(process.argv.slice(2));
const rows = [];
for (const [themeName, palette] of [
  ["dark", dark],
  ["light", light],
]) {
  for (const { token, alpha, files, px } of uses.values()) {
    const fg = palette[token];
    if (!fg) continue;
    for (const surface of SURFACES) {
      const bg = palette[surface];
      if (!bg) continue;
      const r = ratio(alpha < 1 ? over(fg, bg, alpha) : fg, bg);
      const smallest = px.size ? Math.min(...px) : null;
      rows.push({
        theme: themeName,
        token: alpha < 1 ? `${token}/${Math.round(alpha * 100)}` : token,
        surface,
        ratio: Math.round(r * 100) / 100,
        // Everything the app prints at a fixed px size is under 24px,
        // so it is "normal text" and owes 4.5:1.
        threshold: 4.5,
        smallest,
        decorative: alpha < DECORATIVE_ALPHA,
        files: [...files].slice(0, 3),
      });
    }
  }
}

// Filled surfaces: the label token is `--on-hanko`, which each accent
// and the light theme set for itself.
for (const [themeName, palette] of [
  ["dark", dark],
  ["light", light],
]) {
  // Surfaces that actually carry a label. `--hanko-bright` is the red
  // used as text and, in three decorative spots, as a bare fill with
  // nothing written on it.
  for (const surface of ["hanko", "hanko-deep", "gold"]) {
    const bg = palette[surface];
    if (!bg) continue;
    const fgToken = surface === "gold" ? "ink-0" : "on-hanko";
    const fg = fgToken === "on-hanko" ? palette["on-hanko-resolved"] : palette[fgToken];
    if (!fg) continue;
    rows.push({
      theme: themeName,
      token: fgToken,
      surface: `bg-${surface}`,
      ratio: Math.round(ratio(fg, bg) * 100) / 100,
      threshold: 4.5,
      smallest: null,
      decorative: false,
      files: ["filled buttons"],
    });
  }
}

// The accent palettes move `--hanko*` and, for the pastel ones, the
// label ink with it. Check the button and the red-as-text usage.
for (const accent of accents) {
  const palette = paletteOf(`:root[data-accent="${accent}"]`, dark);
  rows.push({
    theme: `accent:${accent}`,
    token: "on-hanko",
    surface: "bg-hanko",
    ratio: Math.round(ratio(palette["on-hanko-resolved"], palette.hanko) * 100) / 100,
    threshold: 4.5,
    smallest: null,
    decorative: false,
    files: ["filled buttons"],
  });
  // `--hanko` is the filled surface; `--hanko-bright` is the same accent
  // used as text on ink. Check each in its own role.
  for (const surface of SURFACES) {
    rows.push({
      theme: `accent:${accent}`,
      token: "hanko-bright",
      surface,
      ratio:
        Math.round(ratio(palette["hanko-bright"], palette[surface]) * 100) / 100,
      threshold: 4.5,
      smallest: null,
      decorative: false,
      files: ["the accent used as text"],
    });
  }
}

const failures = [];
const decorative = [];
const accepted = [];
for (const r of rows) {
  if (r.ratio >= r.threshold) continue;
  if (r.decorative) decorative.push(r);
  else if (acceptedOf(r)) accepted.push({ ...r, why: acceptedOf(r).why });
  else failures.push(r);
}

if (args.has("--json")) {
  console.log(JSON.stringify({ rows, failures, accepted, decorative }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

const line = (r) => {
  const size = r.smallest ? ` · smallest ${r.smallest}px` : "";
  return `  ${String(r.ratio).padStart(5)}:1  text-${r.token.padEnd(16)} on ${r.surface.padEnd(14)}${size}`;
};
const show = args.has("--all") ? rows : failures;
const byTheme = new Map();
for (const r of show) {
  if (!byTheme.has(r.theme)) byTheme.set(r.theme, []);
  byTheme.get(r.theme).push(r);
}
for (const [theme, list] of byTheme) {
  console.log(`\n── ${theme} ──`);
  for (const r of list.sort((a, b) => a.ratio - b.ratio)) {
    console.log(`${r.ratio < r.threshold ? "✗" : "·"}${line(r).slice(1)}`);
    if (r.ratio < r.threshold && r.files.length)
      console.log(`         ${r.files.join(", ")}`);
  }
}
if (accepted.length) {
  console.log(`\n── accepted, on purpose ──`);
  for (const r of accepted) {
    console.log(`  ~${line(r).slice(1)}  [${r.theme}]`);
    console.log(`         ${r.why}`);
  }
}
if (decorative.length && args.has("--all")) {
  console.log(
    `\n── decorative (under ${DECORATIVE_ALPHA * 100} % opacity — watermarks, not text) ──`,
  );
  for (const r of decorative.sort((a, b) => a.ratio - b.ratio)) console.log(`  ~${line(r).slice(1)}`);
}

const checked = rows.length - decorative.length;
console.log(
  `\n${failures.length} failure(s) · ${accepted.length} accepted · ${decorative.length} decorative ignored · ${checked} pair(s) checked at 4.5:1 (WCAG AA, normal text).`,
);
process.exit(failures.length ? 1 : 0);
