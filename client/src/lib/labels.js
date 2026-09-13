/*
 * 札 Fuda · Printable label sheets for physical tomes.
 *
 * Avery-style sheets: one sticker per tome carrying the series title,
 * a "T.12" tome line, an optional third line (edition, shelf, box…)
 * and an EAN-13 barcode of the tome's ISBN — the same code the app's
 * scanner already reads, so a label on the spine or the slipcase
 * opens the volume back in the app.
 *
 * Two layers, deliberately kept apart:
 *
 *   • Pure maths and text helpers — sheet geometry (`LABEL_TEMPLATES`,
 *     `layoutSheet`, `pageOf`…), EAN-13 validation, the label builders
 *     (`tomeLabels`, `boxLabel`) and the in-label layout planner. No
 *     DOM, no React, no app imports (Dexie / axios would otherwise
 *     ride along into the tests). Everything here runs under Vitest.
 *
 *   • `buildLabelPdf` — the only async, DOM-touching entry point. It
 *     lazy-imports `jspdf` and `jsbarcode` (≈400 KB together, never in
 *     the initial bundle) and paints EACH label on an offscreen
 *     <canvas> before placing it in the PDF as a bitmap.
 *
 * Why bitmap labels rather than jsPDF text: jsPDF's built-in fonts
 * (Helvetica / Times / Courier) only cover Latin-1. Titles on these
 * shelves are kanji, kana, Hangul, accented Latin — drawing through
 * the browser's system font stack renders any script, and embedding
 * a CJK font in the PDF would cost more bytes than the sticker
 * bitmaps do. At `scale = 4` (4× CSS pixels ≈ 384 dpi) a 63.5 mm
 * label is ~960 px wide: crisp on any office printer, and the bars
 * stay integer-pixel aligned so the scanner reads them back.
 *
 * Everything is millimetres unless a name says `Px`.
 */

const CSS_PX_PER_MM = 96 / 25.4;

// Line height as a multiple of the font size, for every text style.
const LINE_HEIGHT = 1.2;

// The system stack — not the app's display fonts. Labels are printed,
// and the point is script coverage: whatever the OS draws kanji with.
const LABEL_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Noto Sans JP", "Noto Sans CJK JP", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif';
const BARCODE_FONT_STACK =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/* ─── Sheet geometry ─────────────────────────────────────────────── */

export const PAGE_SIZES = Object.freeze({
  a4: Object.freeze({ w: 210, h: 297 }),
  letter: Object.freeze({ w: 215.9, h: 279.4 }),
});

export const DEFAULT_TEMPLATE_ID = "avery-l7160";

/*
 * Published Avery geometry. Every one of these layouts is symmetric —
 * the left/right and top/bottom margins are equal — so the margins
 * below are the exact centred values (page − grid) / 2. Avery's own
 * spec sheets print them rounded to 0.1 mm (L7160: 7.2 / 15.1 mm,
 * here 7.25 / 15.15), well inside the ±1 mm feed tolerance of any
 * desktop printer. Letter sizes are the inch values converted exactly
 * (5160: 2⅝″ × 1″, 5163: 4″ × 2″). `layoutSheet` is what consumes
 * these; the tests pin that each grid fits its page and stays centred.
 */
export const LABEL_TEMPLATES = Object.freeze({
  "avery-l7160": Object.freeze({
    id: "avery-l7160",
    name: "Avery L7160",
    page: "a4",
    cols: 3,
    rows: 7,
    labelW: 63.5,
    labelH: 38.1,
    marginTop: 15.15,
    marginLeft: 7.25,
    gapX: 2.5,
    gapY: 0,
  }),
  "avery-l7163": Object.freeze({
    id: "avery-l7163",
    name: "Avery L7163",
    page: "a4",
    cols: 2,
    rows: 7,
    labelW: 99.1,
    labelH: 38.1,
    marginTop: 15.15,
    marginLeft: 4.65,
    gapX: 2.5,
    gapY: 0,
  }),
  // Small spine labels — 65 per sheet.
  "avery-l7651": Object.freeze({
    id: "avery-l7651",
    name: "Avery L7651",
    page: "a4",
    cols: 5,
    rows: 13,
    labelW: 38.1,
    labelH: 21.2,
    marginTop: 10.7,
    marginLeft: 4.75,
    gapX: 2.5,
    gapY: 0,
  }),
  "avery-5160": Object.freeze({
    id: "avery-5160",
    name: "Avery 5160",
    page: "letter",
    cols: 3,
    rows: 10,
    labelW: 66.675,
    labelH: 25.4,
    marginTop: 12.7,
    marginLeft: 4.7625,
    gapX: 3.175,
    gapY: 0,
  }),
  "avery-5163": Object.freeze({
    id: "avery-5163",
    name: "Avery 5163",
    page: "letter",
    cols: 2,
    rows: 5,
    labelW: 101.6,
    labelH: 50.8,
    marginTop: 12.7,
    marginLeft: 3.96875,
    gapX: 4.7625,
    gapY: 0,
  }),
});

/** Page dimensions (mm) of a template's sheet. */
export function pageSize(template) {
  return PAGE_SIZES[template?.page] ?? PAGE_SIZES.a4;
}

/** Labels per sheet. */
export function perPage(template) {
  return template.cols * template.rows;
}

/**
 * Top-left corner (mm) of every label on one sheet, row-major: index
 * 0 is top-left, index `cols` starts the second row. Pure.
 */
export function layoutSheet(template) {
  const out = [];
  for (let row = 0; row < template.rows; row++) {
    for (let col = 0; col < template.cols; col++) {
      out.push({
        x: template.marginLeft + col * (template.labelW + template.gapX),
        y: template.marginTop + row * (template.labelH + template.gapY),
      });
    }
  }
  return out;
}

/** Zero-based sheet a running label index lands on. */
export function pageOf(index, template) {
  return Math.floor(index / perPage(template));
}

/** Position within its sheet (0 … cols×rows−1) of a running index. */
export function slotOf(index, template) {
  return index % perPage(template);
}

/** Sheets needed for `count` labels, the first one starting at `startAt`. */
export function pageCount(count, template, startAt = 0) {
  if (count <= 0) return 0;
  return pageOf(startAt + count - 1, template) + 1;
}

/**
 * State of every cell of one sheet — `"skipped"` (before `startAt`,
 * already peeled off a partly used sheet), `"used"` or `"free"`. Drives
 * the live preview grid; the PDF builder follows the same arithmetic.
 */
export function sheetOccupancy(count, template, startAt = 0, page = 0) {
  const slots = perPage(template);
  const first = page * slots;
  const cells = [];
  for (let i = 0; i < slots; i++) {
    const slot = first + i;
    if (slot < startAt) cells.push("skipped");
    else if (slot < startAt + count) cells.push("used");
    else cells.push("free");
  }
  return cells;
}

/** The numbers the modal's summary line shows. */
export function summarizeLabels(labels, template, startAt = 0) {
  const list = Array.isArray(labels) ? labels : [];
  return {
    count: list.length,
    pages: pageCount(list.length, template, startAt),
    withoutBarcode: list.filter((l) => !isEan13(l?.barcode)).length,
  };
}

/* ─── EAN-13 / ISBN ──────────────────────────────────────────────── */

function stripSeparators(raw) {
  return String(raw ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

// GS1 check digit for a 12-digit body: weights 1,3,1,3… then the
// complement to the next multiple of ten.
function ean13CheckDigit(body12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

function isValidIsbn10(digits10) {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits10[i]) * (10 - i);
  sum += digits10[9] === "X" ? 10 : Number(digits10[9]);
  return sum % 11 === 0;
}

/**
 * True for a well-formed EAN-13 (13 digits, valid check digit).
 * Separators (spaces, hyphens) are tolerated. Every ISBN-13 is an
 * EAN-13 in the 978/979 "Bookland" range, so a stored ISBN passes.
 */
export function isEan13(str) {
  const s = stripSeparators(str);
  if (!/^\d{13}$/.test(s)) return false;
  return ean13CheckDigit(s.slice(0, 12)) === Number(s[12]);
}

/**
 * The 13-digit barcode for a stored ISBN, or `null` when the value is
 * not a valid ISBN-10 / ISBN-13 / EAN-13. ISBN-10s are converted to
 * their 978 form — that is what the printed barcode of the book
 * carries, and what the scanner will report back.
 */
export function ean13Of(raw) {
  const s = stripSeparators(raw);
  if (/^\d{13}$/.test(s)) return isEan13(s) ? s : null;
  if (/^\d{9}[\dX]$/.test(s)) {
    if (!isValidIsbn10(s)) return null;
    const body = `978${s.slice(0, 9)}`;
    return `${body}${ean13CheckDigit(body)}`;
  }
  return null;
}

/* ─── Label builders ─────────────────────────────────────────────── */

/**
 * "T.12" from a tome number and the caller's word for tome. A word
 * ending in punctuation glues to the number ("T." → "T.12", "Vol." →
 * "Vol.12"); any other word gets a space ("Tome" → "Tome 12"); a
 * `{n}` placeholder is substituted verbatim ("第{n}巻" → "第12巻").
 */
export function tomeLine(n, tomeWord = "T.") {
  const word = String(tomeWord ?? "").trim();
  if (!word) return String(n);
  if (word.includes("{n}")) return word.replace("{n}", String(n));
  return /[.#№]$/.test(word) ? `${word}${n}` : `${word} ${n}`;
}

/**
 * One label per tome of a series, sorted by tome number.
 *
 *   tomeLabels(series, volumes, { tomeWord: t("labels.tomeWord"), line3 })
 *
 * `title` is the series name; `line2` the tome line; `line3` an
 * optional string, or a `(volume, series) => string | null` callback
 * so the caller can print the edition, the shelf, the box…; `barcode`
 * is the tome's own `isbn` when it is a usable code, else the
 * announced `release_isbn` when that one is, else `null` (text-only
 * label). "Usable" matters: an `isbn` with a broken check digit would
 * either crash the barcode encoder or print a code no scanner accepts,
 * so it is skipped in favour of the release ISBN.
 */
export function tomeLabels(series, volumes, opts = {}) {
  const { tomeWord = "T.", line3 = null } = opts;
  const title = String(series?.name ?? series?.title ?? "").trim();
  return (Array.isArray(volumes) ? volumes : [])
    .map((v) => ({ volume: v, n: tomeNumber(v) }))
    .filter((e) => e.n != null)
    .sort((a, b) => a.n - b.n)
    .map(({ volume, n }) => ({
      title,
      line2: tomeLine(n, tomeWord),
      line3: resolveLine3(line3, volume, series),
      barcode: ean13Of(volume.isbn) ?? ean13Of(volume.release_isbn) ?? null,
    }));
}

// A tome number or `null` — `Number(null)` is 0, so the empty cases
// are checked before coercing.
function tomeNumber(volume) {
  const raw = volume?.vol_num;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function resolveLine3(line3, volume, series) {
  const value = typeof line3 === "function" ? line3(volume, series) : line3;
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

export const BOX_LABEL_MAX_LINES = 8;
export const BOX_LABEL_MAX_CHARS = 40;

/**
 * Hard cut at `maxChars` code points with a trailing "…". Counted in
 * code points, not UTF-16 units, so a kanji title is not sliced
 * through a surrogate pair.
 */
export function truncate(str, maxChars) {
  const chars = Array.from(String(str ?? ""));
  if (chars.length <= maxChars) return chars.join("");
  return `${chars
    .slice(0, Math.max(0, maxChars - 1))
    .join("")
    .trimEnd()}…`;
}

/**
 * A single label for a storage box listing its contents: the box name
 * as title, then up to `maxLines` lines. Blank lines are dropped, long
 * lines cut with "…", and when there are more lines than fit the last
 * slot becomes "+N more" (`moreLabel`, with `{n}`), so the label never
 * silently loses entries.
 */
export function boxLabel(name, lines, opts = {}) {
  const {
    maxLines = BOX_LABEL_MAX_LINES,
    maxChars = BOX_LABEL_MAX_CHARS,
    moreLabel = "+{n} more",
  } = opts;
  const clean = (Array.isArray(lines) ? lines : [])
    .map((l) => (l == null ? "" : String(l).trim()))
    .filter(Boolean)
    .map((l) => truncate(l, maxChars));
  let out = clean;
  if (clean.length > maxLines) {
    const keep = Math.max(0, maxLines - 1);
    out = [
      ...clean.slice(0, keep),
      String(moreLabel).replace("{n}", String(clean.length - keep)),
    ];
  }
  return { title: String(name ?? "").trim(), lines: out };
}

/* ─── Text fitting (measure-agnostic, tested with a fake ruler) ──── */

/**
 * `text` cut to `maxWidth` with a trailing "…", `measure(str)` being
 * the width of a string in whatever unit `maxWidth` is. Binary search
 * over code points.
 */
export function ellipsize(text, maxWidth, measure) {
  const full = String(text ?? "");
  if (measure(full) <= maxWidth) return full;
  const chars = Array.from(full);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = `${chars.slice(0, mid).join("").trimEnd()}…`;
    if (measure(candidate) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "…" : `${chars.slice(0, lo).join("").trimEnd()}…`;
}

/**
 * Greedy word wrap into at most `maxLines` lines; the last line is
 * ellipsized when the text does not fit. A single word wider than the
 * line (kanji titles have no spaces) is broken into character runs,
 * which rejoin without a space — so "鋼の錬金術師" wraps like text,
 * not like one unbreakable token.
 */
export function wrapText(text, maxWidth, measure, maxLines = 2) {
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || maxLines < 1) return [];

  // Tokens that each fit on a line. `glue` marks a character run that
  // continues the previous token without a separating space.
  const tokens = [];
  for (const word of words) {
    if (measure(word) <= maxWidth) {
      tokens.push({ text: word, glue: false });
      continue;
    }
    let run = "";
    let first = true;
    for (const ch of Array.from(word)) {
      if (run && measure(run + ch) > maxWidth) {
        tokens.push({ text: run, glue: !first });
        first = false;
        run = ch;
      } else {
        run += ch;
      }
    }
    if (run) tokens.push({ text: run, glue: !first });
  }

  const lines = [];
  let cur = "";
  let i = 0;
  for (; i < tokens.length; i++) {
    const { text: tok, glue } = tokens[i];
    const candidate = cur ? (glue ? cur + tok : `${cur} ${tok}`) : tok;
    if (!cur || measure(candidate) <= maxWidth) {
      cur = candidate;
      continue;
    }
    lines.push(cur);
    cur = tok;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines) {
    if (cur) lines.push(cur);
    return lines;
  }
  // Overflow: fold the remainder into the last line and cut it there.
  const rest = tokens
    .slice(i)
    .map((t) => (t.glue ? t.text : ` ${t.text}`))
    .join("");
  lines[maxLines - 1] = ellipsize(
    lines[maxLines - 1] + rest,
    maxWidth,
    measure,
  );
  return lines;
}

/* ─── In-label layout ────────────────────────────────────────────── */

const TITLE_WEIGHT = 700;
const SUB_WEIGHT = 600;
const META_WEIGHT = 400;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Where everything goes inside one label, in mm. `measure(text,
 * weight, sizeMm)` returns a text width in mm — the canvas renderer
 * passes a real ruler, the tests a fake one. Pure otherwise.
 *
 *   • padding scales with the label height (1.2 – 3 mm)
 *   • a valid barcode reserves a band at the bottom (7 – 18 mm,
 *     digits included); without one the text gets the whole height
 *   • the title is bold, wrapped to at most two lines; `line2` is a
 *     smaller semibold line, `line3` / `lines[]` smaller still
 *   • sizes step down (100 % → 55 %) until the block fits; if a box
 *     label still overflows at the smallest size, trailing lines are
 *     dropped and the last kept one ends in "…"
 */
export function planLabel(label, template, measure) {
  const pad = clamp(template.labelH * 0.07, 1.2, 3);
  const innerW = template.labelW - 2 * pad;
  const innerH = template.labelH - 2 * pad;
  const barcode = isEan13(label?.barcode)
    ? stripSeparators(label.barcode)
    : null;
  const barcodeH = barcode ? clamp(template.labelH * 0.4, 7, 18) : 0;
  const textGap = barcode ? pad * 0.5 : 0;
  const textH = innerH - barcodeH - textGap;

  const title = String(label?.title ?? "").trim();
  const sub = String(label?.line2 ?? "").trim();
  const metas = (Array.isArray(label?.lines) ? label.lines : [label?.line3])
    .map((l) => (l == null ? "" : String(l).trim()))
    .filter(Boolean);

  const baseTitle = clamp(template.labelH * 0.11, 2.2, 5);
  let plan = null;
  for (let step = 0; step <= 9; step++) {
    const titleSize = baseTitle * (1 - step * 0.05);
    const subSize = Math.max(1.8, titleSize * 0.8);
    const metaSize = Math.max(1.6, titleSize * 0.7);
    const titleLines = title
      ? wrapText(title, innerW, (s) => measure(s, TITLE_WEIGHT, titleSize), 2)
      : [];
    const subLine = sub
      ? ellipsize(sub, innerW, (s) => measure(s, SUB_WEIGHT, subSize))
      : null;
    const metaLines = metas.map((m) =>
      ellipsize(m, innerW, (s) => measure(s, META_WEIGHT, metaSize)),
    );
    plan = {
      pad,
      innerW,
      innerH,
      textH,
      textGap,
      barcode,
      barcodeH,
      titleSize,
      subSize,
      metaSize,
      titleLines,
      subLine,
      metaLines,
      total: 0,
    };
    plan.total = blockHeight(plan);
    if (plan.total <= textH) return plan;
  }

  // Smallest size and still too tall (a long box listing on a spine
  // label): shed lines from the bottom, flag the cut.
  let cut = false;
  while (plan.metaLines.length && plan.total > plan.textH) {
    plan.metaLines.pop();
    cut = true;
    plan.total = blockHeight(plan);
  }
  if (cut && plan.metaLines.length) {
    const last = plan.metaLines.length - 1;
    plan.metaLines[last] = ellipsize(`${plan.metaLines[last]} …`, innerW, (s) =>
      measure(s, META_WEIGHT, plan.metaSize),
    );
  }
  return plan;
}

function blockHeight(plan) {
  return (
    plan.titleLines.length * plan.titleSize * LINE_HEIGHT +
    (plan.subLine ? plan.subSize * LINE_HEIGHT : 0) +
    plan.metaLines.length * plan.metaSize * LINE_HEIGHT
  );
}

/* ─── Canvas rendering (browser only) ────────────────────────────── */

function makeFont(weight, sizePx) {
  return `${weight} ${sizePx}px ${LABEL_FONT_STACK}`;
}

/**
 * Paints one label on `canvas` (resized to the label at `scale`× CSS
 * pixels) — white ground, black ink, text centred, barcode bottom.
 * `barcodeCanvas` is the scratch surface JsBarcode draws on.
 */
function paintLabel(label, template, scale, JsBarcode, canvas, barcodeCanvas) {
  const pxPerMm = CSS_PX_PER_MM * scale;
  const px = (mm) => mm * pxPerMm;
  const width = Math.round(px(template.labelW));
  const height = Math.round(px(template.labelH));
  // Setting the size also clears the previous label.
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser");

  const measure = (text, weight, sizeMm) => {
    ctx.font = makeFont(weight, px(sizeMm));
    return ctx.measureText(text).width / pxPerMm;
  };
  const plan = planLabel(label, template, measure);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Text block, vertically centred in the region above the barcode.
  const cx = width / 2;
  let y = px(plan.pad + Math.max(0, (plan.textH - plan.total) / 2));
  const drawLine = (text, weight, sizeMm) => {
    ctx.font = makeFont(weight, px(sizeMm));
    // "top" baseline sits on the em box; nudge a tenth down so the
    // visible glyphs land in the middle of their line height.
    ctx.fillText(text, cx, y + px(sizeMm) * 0.1);
    y += px(sizeMm) * LINE_HEIGHT;
  };
  for (const line of plan.titleLines)
    drawLine(line, TITLE_WEIGHT, plan.titleSize);
  if (plan.subLine) drawLine(plan.subLine, SUB_WEIGHT, plan.subSize);
  for (const line of plan.metaLines) drawLine(line, META_WEIGHT, plan.metaSize);

  if (plan.barcode) {
    paintBarcode(ctx, JsBarcode, barcodeCanvas, plan.barcode, {
      x: px(plan.pad),
      y: px(template.labelH - plan.pad - plan.barcodeH),
      w: px(plan.innerW),
      h: px(plan.barcodeH),
    });
  }
}

/**
 * EAN-13 through JsBarcode on its own canvas, then blitted into the
 * bottom band. The module width is chosen so the finished code
 * (95 modules + the leading digit JsBarcode prints outside the bars)
 * fits the band at 1:1 — no resampling, so bar edges stay crisp.
 */
function paintBarcode(ctx, JsBarcode, barcodeCanvas, value, box) {
  const fontSize = Math.max(8, Math.round(box.h * 0.26));
  const textMargin = Math.max(2, Math.round(fontSize * 0.25));
  const barsHeight = Math.max(4, Math.round(box.h - fontSize - textMargin));
  const moduleWidth = Math.max(1, Math.floor((box.w - fontSize) / 95));
  try {
    JsBarcode(barcodeCanvas, value, {
      format: "EAN13",
      displayValue: true,
      margin: 0,
      width: moduleWidth,
      height: barsHeight,
      fontSize,
      textMargin,
      font: BARCODE_FONT_STACK,
      background: "#ffffff",
      lineColor: "#000000",
    });
  } catch {
    // Encoder refused the value (should not happen past isEan13) —
    // the label stays text-only rather than failing the whole sheet.
    return;
  }
  const k = Math.min(
    1,
    box.w / barcodeCanvas.width,
    box.h / barcodeCanvas.height,
  );
  const dw = barcodeCanvas.width * k;
  const dh = barcodeCanvas.height * k;
  ctx.drawImage(
    barcodeCanvas,
    Math.round(box.x + (box.w - dw) / 2),
    Math.round(box.y + (box.h - dh)),
    Math.round(dw),
    Math.round(dh),
  );
}

function resolveTemplate(template) {
  if (template == null) return LABEL_TEMPLATES[DEFAULT_TEMPLATE_ID];
  if (typeof template === "string") {
    const found = LABEL_TEMPLATES[template];
    if (!found) throw new Error(`Unknown label template "${template}"`);
    return found;
  }
  for (const key of [
    "cols",
    "rows",
    "labelW",
    "labelH",
    "marginTop",
    "marginLeft",
    "gapX",
    "gapY",
  ]) {
    if (!Number.isFinite(template[key])) {
      throw new Error(`Label template is missing "${key}"`);
    }
  }
  if (!PAGE_SIZES[template.page]) {
    throw new Error(
      `Label template has an unknown page size "${template.page}"`,
    );
  }
  return template;
}

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The finished sheet(s) as a PDF Blob.
 *
 *   await buildLabelPdf(labels, { template: "avery-l7160", startAt: 3 })
 *
 * `labels` are the objects `tomeLabels` / `boxLabel` produce (or any
 * `{ title, line2?, line3?, lines?, barcode? }`). `template` is a
 * preset id or a template object (default L7160); `startAt` skips
 * that many positions on the first sheet (a partly used one);
 * `scale` is the canvas oversampling (4 ≈ 384 dpi); `onProgress(done,
 * total)` fires after each label. Pages are added as the grid fills.
 *
 * `jspdf` and `jsbarcode` are imported here, on first use — keep it
 * that way, they must never land in the initial bundle.
 */
export async function buildLabelPdf(labels, opts = {}) {
  const { startAt = 0, scale = 4, onProgress } = opts;
  const template = resolveTemplate(opts.template);
  const [{ jsPDF }, jsbarcodeModule] = await Promise.all([
    import("jspdf"),
    import("jsbarcode"),
  ]);
  const JsBarcode = jsbarcodeModule.default ?? jsbarcodeModule;

  const positions = layoutSheet(template);
  const slots = positions.length;
  const first = clamp(Math.trunc(Number(startAt) || 0), 0, slots - 1);
  const list = Array.isArray(labels) ? labels : [];

  const doc = new jsPDF({
    unit: "mm",
    format: template.page,
    orientation: "portrait",
    compress: true,
  });
  doc.setProperties({
    title: "MangaCollector · labels",
    creator: "MangaCollector",
  });

  const canvas = document.createElement("canvas");
  const barcodeCanvas = document.createElement("canvas");
  let page = 0;
  for (let i = 0; i < list.length; i++) {
    const slot = first + i;
    const target = Math.floor(slot / slots);
    while (page < target) {
      doc.addPage();
      page++;
    }
    const { x, y } = positions[slot % slots];
    paintLabel(list[i], template, scale, JsBarcode, canvas, barcodeCanvas);
    doc.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      x,
      y,
      template.labelW,
      template.labelH,
      undefined,
      "FAST",
    );
    onProgress?.(i + 1, list.length);
    // Let the UI repaint its progress between batches of stickers.
    if ((i + 1) % 6 === 0) await yieldToMain();
  }
  return doc.output("blob");
}
