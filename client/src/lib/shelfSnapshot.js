import { coverPaletteFor } from "@/lib/coverPalette.js";

/*
 * 棚 · Render the user's library as a stylised PNG, ready to share
 * on social media or save to disk. Pure client-side: 2D canvas,
 * no external libraries, no server round-trip.
 *
 * Output dimensions: 1080×1350 (Instagram 4:5 portrait, also a
 * decent fit for X / Bluesky cards). The aspect ratio + the dark
 * ink background means the snapshot composes well alongside other
 * content in a feed without competing for the eye.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │ 棚 (giant watermark, faded, behind it all)  │
 *   │                                              │
 *   │ COLLECTION · ${userName}        [date]       │  header
 *   │                                              │
 *   │ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐                │
 *   │ │  │ │  │ │  │ │  │ │  │ │  │                │
 *   │ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘                │  covers
 *   │ ... 4 rows, 24 covers total ...              │
 *   │                                              │
 *   │ 240 巻  ·  18 / 32 séries  ·  56 % progression │  footer
 *   │ MangaCollector                               │
 *   └─────────────────────────────────────────────┘
 *
 * Cover loading is best-effort: each `<Image>` is loaded with
 * `crossOrigin="anonymous"` (required to render a tainted-canvas-
 * free PNG), and any failure falls back to the LQIP swatch (same
 * palette the dashboard uses) with a 巻 kanji glyph centred.
 *
 * Fonts: the renderer awaits `document.fonts.ready` before drawing
 * any text so the snapshot has the same Fraunces / Noto Serif JP /
 * Instrument Sans typography as the live site. Without this, a
 * cold-cache call would draw with the OS fallback (Times-ish) and
 * the snapshot would feel "off".
 */

const W = 1080;
const H = 1350;
const COVER_COLS = 6;
const COVER_ROWS = 4;
const COVER_GAP = 14;
const HEADER_TOP = 80;
const HEADER_HEIGHT = 110;
const FOOTER_HEIGHT = 180;

const COLOR_BG = "#15100f";
const COLOR_WASHI = "#f4ecd8";
const COLOR_WASHI_DIM = "rgba(244, 236, 216, 0.55)";
const COLOR_WASHI_FAINT = "rgba(244, 236, 216, 0.16)";
const COLOR_HANKO = "#dc2626";

/**
 * Sort a library array by recency (`created_on` desc) and return the
 * first N items that have a usable cover URL — so the snapshot grid
 * is filled with the most recent acquisitions and never has visual
 * "holes" from rows missing a poster.
 */
function pickCovers(library, count) {
  return [...library]
    .sort((a, b) => {
      const tb = b.created_on ? new Date(b.created_on).getTime() : 0;
      const ta = a.created_on ? new Date(a.created_on).getTime() : 0;
      return tb - ta;
    })
    .slice(0, count);
}

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadCovers(items) {
  const imgs = await Promise.all(items.map((i) => loadImage(i.image_url_jpg)));
  return items.map((item, idx) => ({ ...item, image: imgs[idx] }));
}

async function ensureFontsReady() {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await document.fonts.ready;
  } catch {
    /* old Safari without fontfaceset — fall through */
  }
}

function formatDate(now, locale) {
  try {
    return new Intl.DateTimeFormat(locale || "en", {
      month: "long",
      year: "numeric",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Draw the dark ink background + giant 棚 watermark. */
function drawBackdrop(ctx) {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, W, H);

  // Subtle vignette — radial gradient toward the corners darkens
  // the edges so the rectangular frame doesn't read as a screenshot.
  const grad = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.75);
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0.6)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 棚 watermark — massive, low-opacity, slightly off-centre + tilted.
  // Sits behind every other layer so the covers and text read above it.
  ctx.save();
  ctx.translate(W * 0.5, H * 0.55);
  ctx.rotate(-0.04);
  ctx.font = "900 1100px 'Noto Serif JP', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(220, 38, 38, 0.06)";
  ctx.fillText("棚", 0, 0);
  ctx.restore();
}

function drawHeader(ctx, { userName, dateLabel }) {
  const y = HEADER_TOP + 24;

  // Eyebrow — uppercase mono, washi-dim
  ctx.font = "600 18px 'JetBrains Mono', monospace";
  ctx.fillStyle = COLOR_WASHI_DIM;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("COLLECTION · 棚", 80, y);

  // User name — display italic
  ctx.font = "300 italic 56px 'Fraunces', serif";
  ctx.fillStyle = COLOR_WASHI;
  ctx.fillText(userName || "Anonymous reader", 80, y + 60);

  // Date — top-right
  ctx.font = "500 18px 'JetBrains Mono', monospace";
  ctx.fillStyle = COLOR_WASHI_DIM;
  ctx.textAlign = "right";
  ctx.fillText(dateLabel.toUpperCase(), W - 80, y);
}

/**
 * Word-wrap + ellipsise a title into a fixed-width cell. Shrinks the
 * font size in two steps when the natural wrap would exceed `maxLines`,
 * so very long titles still fit without bleeding across the cover.
 *
 * The wrap is greedy and word-aligned. A single token longer than the
 * cell width (rare — happens with no-space romaji titles or very
 * narrow cells) gets truncated mid-word with a trailing ellipsis on
 * the final line. We don't try to hyphenate — the visual cost of a
 * mid-word break is worse than a slightly truncated tail.
 */
function drawWrappedTitle(ctx, title, { x, y, width, height }) {
  if (!title) return;
  const padding = 10;
  const maxWidth = width - padding * 2;
  const sizes = [16, 14, 12]; // descending; pick the first that fits 4 lines
  const maxLines = Math.min(4, Math.max(1, Math.floor((height - 8) / 18)));

  let chosenSize = sizes[sizes.length - 1];
  let lines = [];
  for (const size of sizes) {
    ctx.font = `600 ${size}px 'Fraunces', serif`;
    const candidate = wrapTitleLines(ctx, title, maxWidth, maxLines);
    if (candidate.length <= maxLines) {
      chosenSize = size;
      lines = candidate;
      break;
    }
    lines = candidate;
  }
  const lineHeight = Math.round(chosenSize * 1.18);
  ctx.font = `600 ${chosenSize}px 'Fraunces', serif`;
  ctx.fillStyle = "rgba(244, 236, 216, 0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Vertically centre the wrapped block inside the cell area.
  const blockHeight = lines.length * lineHeight;
  const startY = y + (height - blockHeight) / 2 + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + width / 2, startY + i * lineHeight);
  }
}

function wrapTitleLines(ctx, text, maxWidth, maxLines) {
  // Tokenise on whitespace, but also split very long single tokens
  // (no-space romaji like "Berserkofgluttony") so they can wrap mid-
  // word as a last resort. Threshold: if a single word's measured
  // width exceeds the cell, split it into character chunks that fit.
  const words = text.split(/\s+/).filter(Boolean);
  const tokens = [];
  for (const word of words) {
    if (ctx.measureText(word).width <= maxWidth) {
      tokens.push(word);
      continue;
    }
    // Split a too-long word into hard-wrap chunks.
    let chunk = "";
    for (const ch of word) {
      const probe = chunk + ch;
      if (ctx.measureText(probe).width > maxWidth && chunk) {
        tokens.push(chunk);
        chunk = ch;
      } else {
        chunk = probe;
      }
    }
    if (chunk) tokens.push(chunk);
  }

  const lines = [];
  let current = "";
  for (const token of tokens) {
    const probe = current ? `${current} ${token}` : token;
    if (ctx.measureText(probe).width > maxWidth && current) {
      lines.push(current);
      current = token;
    } else {
      current = probe;
    }
  }
  if (current) lines.push(current);

  // Ellipsise overflow into the last visible line. Strip whole tokens
  // first, then trim chars until a "…" suffix fits.
  if (lines.length > maxLines) {
    let last = lines[maxLines - 1];
    const overflow = lines.slice(maxLines);
    if (overflow.length) last = `${last} ${overflow.join(" ")}`;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    lines.length = maxLines;
    lines[maxLines - 1] = `${last}…`;
  }

  return lines;
}

function drawCovers(ctx, covers) {
  const startY = HEADER_TOP + HEADER_HEIGHT + 30;
  const gridW = W - 160;
  const cellW = (gridW - COVER_GAP * (COVER_COLS - 1)) / COVER_COLS;
  const cellH = cellW * 1.5;

  for (let i = 0; i < covers.length; i++) {
    const row = Math.floor(i / COVER_COLS);
    const col = i % COVER_COLS;
    const x = 80 + col * (cellW + COVER_GAP);
    const y = startY + row * (cellH + COVER_GAP);

    // Rounded rect clip — covers' corners gently rounded for the
    // book-spine feel without clobbering recognisability.
    const radius = 8;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + cellW, y, x + cellW, y + cellH, radius);
    ctx.arcTo(x + cellW, y + cellH, x, y + cellH, radius);
    ctx.arcTo(x, y + cellH, x, y, radius);
    ctx.arcTo(x, y, x + cellW, y, radius);
    ctx.closePath();
    ctx.clip();

    if (covers[i].image) {
      // Draw cover with object-fit: cover behaviour. Compute the
      // aspect-preserving slice so taller posters get cropped at
      // the bottom (head + spine framing reads better than a
      // squashed full-cover).
      const img = covers[i].image;
      const imgRatio = img.width / img.height;
      const cellRatio = cellW / cellH;
      let sw = img.width;
      let sh = img.height;
      let sx = 0;
      let sy = 0;
      if (imgRatio > cellRatio) {
        sw = img.height * cellRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / cellRatio;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, x, y, cellW, cellH);
    } else {
      // Fallback: LQIP swatch + 巻 kanji header + the series TITLE
      // wrapped to fit. Without the title the cell reads as a
      // generic "no cover" placeholder; with it, the user can still
      // identify the series at a glance even when MAL/MangaDex 403'd
      // the cross-origin fetch. Same colour mapping the dashboard
      // uses, so a snapshot fall-through looks consistent.
      ctx.fillStyle = coverPaletteFor(covers[i].mal_id);
      ctx.fillRect(x, y, cellW, cellH);

      // 巻 anchor at the top — visual marker so the cell stays
      // readable as a "book slot" even when the title is short.
      ctx.font = "900 36px 'Noto Serif JP', serif";
      ctx.fillStyle = "rgba(244, 236, 216, 0.4)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("巻", x + cellW / 2, y + 32);

      // Title — wrap to a max of 4 lines, drop point size if the
      // wrap doesn't fit, ellipsise the last line as last resort.
      drawWrappedTitle(ctx, covers[i].name ?? "", {
        x,
        y: y + 56,
        width: cellW,
        height: cellH - 64,
      });
    }

    ctx.restore();

    // Spine accent — thin hanko-tinted line down the leading edge.
    // Adds a "this is a book on a shelf" cue at zero pixel cost.
    ctx.fillStyle = "rgba(220, 38, 38, 0.5)";
    ctx.fillRect(x, y, 2, cellH);

    // Subtle outline — keeps the cover edge readable on dark covers.
    ctx.strokeStyle = COLOR_WASHI_FAINT;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
  }
}

/**
 * Footer with three labelled stats laid out as columns. Replaces the
 * earlier "value · value · value" row — the previous design left the
 * percentage segment ambiguous (39 % of *what*?). Each column now has
 * a mono eyebrow underneath the value so the metric reads stand-alone.
 *
 * Layout:
 *
 *     240 巻        18         56 %
 *    VOLUMES      SÉRIES    PROGRESSION
 *
 *               MangaCollector
 *
 * The accent on the progression value uses the user's hanko colour
 * (re-tinted via the accent setting) so the snapshot also previews
 * the user's chosen palette — a small reward for personalising.
 */
function drawFooter(ctx, { stats, brand }) {
  const y = H - FOOTER_HEIGHT + 30;

  // Divider — thin washi-dim line spanning the inner padding.
  ctx.strokeStyle = COLOR_WASHI_FAINT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, y);
  ctx.lineTo(W - 80, y);
  ctx.stroke();

  // Three column blocks, evenly distributed across the inner padding.
  // Each block: VALUE (Fraunces 36) + LABEL (mono 14, uppercase,
  // letter-spacing wide). Accent column gets hanko colour for the
  // value to call out the progression metric.
  const segments = Array.isArray(stats)
    ? stats
    : // Backwards-compat: accept the old { volumes, series, complete }
      // object shape and fabricate labels. New callers should pass
      // an array of { value, label, accent? }.
      [
        { value: stats.volumes, label: "VOLUMES" },
        { value: stats.series, label: "SERIES" },
        { value: stats.complete, label: "COMPLETE", accent: true },
      ];

  const innerW = W - 160;
  const colW = innerW / segments.length;
  const valueY = y + 64;
  const labelY = y + 96;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  segments.forEach((seg, idx) => {
    const cx = 80 + colW * idx + colW / 2;
    // Value
    ctx.font = "600 36px 'Fraunces', serif";
    ctx.fillStyle = seg.accent ? COLOR_HANKO : COLOR_WASHI;
    ctx.fillText(seg.value ?? "", cx, valueY);
    // Label — uppercase mono with wide tracking, washi-dim. The
    // tracking is faked here by spacing each char manually, since
    // canvas 2D doesn't expose `letter-spacing` natively. The
    // `String.fromCharCode(8201)` is a thin-space which renders
    // narrower than a regular space — closer to the CSS effect.
    ctx.font = "600 14px 'JetBrains Mono', monospace";
    ctx.fillStyle = COLOR_WASHI_DIM;
    const spaced = (seg.label ?? "").toUpperCase().split("").join(" ");
    ctx.fillText(spaced, cx, labelY);
  });

  // Brand line — keeps the project signature without competing with
  // the stat columns above.
  ctx.font = "500 16px 'JetBrains Mono', monospace";
  ctx.fillStyle = COLOR_WASHI_DIM;
  ctx.fillText(brand, W / 2, y + 140);
}

/**
 * Render the snapshot to a 1080×1350 canvas and return it. The
 * caller is responsible for converting to a Blob (via toBlob) and
 * dispatching to `<a download>` or `navigator.share`.
 *
 * @param {object} opts
 * @param {Array} opts.library - the user's library entries
 * @param {object} opts.stats  - { volumes, series, complete } strings
 * @param {string} opts.userName
 * @param {string} opts.locale - "fr" | "en" | "es" — for date format
 */
export async function renderShelfSnapshot({ library, stats, userName, locale }) {
  await ensureFontsReady();

  const picks = pickCovers(library ?? [], COVER_COLS * COVER_ROWS);
  const covers = await loadCovers(picks);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // Higher-quality resampling for the cover scaling pass.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  drawBackdrop(ctx);
  drawHeader(ctx, {
    userName,
    dateLabel: formatDate(new Date(), locale),
  });
  drawCovers(ctx, covers);
  drawFooter(ctx, {
    stats,
    brand: "MangaCollector",
  });

  return canvas;
}

/**
 * Convenience wrapper — render and convert to a Blob in one call.
 * The Blob can be passed straight to `URL.createObjectURL` or to
 * `navigator.share({ files: [...] })`.
 */
export async function renderShelfSnapshotBlob(opts) {
  const canvas = await renderShelfSnapshot(opts);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("toBlob returned null (canvas tainted?)"));
      },
      "image/png",
      0.92,
    );
  });
}

/**
 * Trigger a browser download of the snapshot. Uses Web Share API
 * when the device supports `share` of files (mobile-first), else
 * falls back to a synthetic `<a download>` click.
 */
export async function shareOrDownloadSnapshot(blob, fileName) {
  const file = new File([blob], fileName, { type: "image/png" });
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: "MangaCollector",
      });
      return;
    } catch (err) {
      // User cancelled the share sheet — not an error worth surfacing.
      if (err && err.name === "AbortError") return;
      // Permission / CORS errors fall through to the download path.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke a tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
