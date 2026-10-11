/*
 * 図 · The geometry behind the stats page's charts — pure, so it is
 * tested on its own (`scale.test.js`).
 *
 * The page used to draw four charts with recharts: 92 kB gzipped and
 * most of the 1.8 s of script a phone spent opening /stats, for bar
 * charts and two rings. What they need fits here: round ticks for a
 * value axis, bands for the bars, and arcs for the rings.
 */

/**
 * Round ticks from 0 to at least `max`: about `count` steps of 1, 2, 2.5
 * or 5 × 10ⁿ. `integers` keeps the step whole (counts of tomes).
 */
export function niceTicks(max, { count = 4, integers = false } = {}) {
  const top = Number.isFinite(max) && max > 0 ? max : 0;
  if (top === 0) return [0, 1];
  const raw = top / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  let step = magnitude;
  for (const m of [1, 2, 2.5, 5, 10]) {
    step = m * magnitude;
    if (step >= raw) break;
  }
  if (integers) step = Math.max(1, Math.ceil(step));
  const ticks = [];
  for (let v = 0; v < top + step / 2; v += step) {
    ticks.push(Number(v.toFixed(10)));
    if (v >= top) break;
  }
  if (ticks.at(-1) < top) ticks.push(Number((ticks.at(-1) + step).toFixed(10)));
  return ticks;
}

/**
 * Bands for `n` bars across `width`: each band is `width / n`, the bar
 * takes `1 - gap` of it, centred.
 */
export function bandLayout(n, width, { gap = 0.2 } = {}) {
  const band = n > 0 ? width / n : 0;
  const bar = band * (1 - gap);
  return {
    band,
    bar,
    x: (i) => i * band + (band - bar) / 2,
  };
}

/** SVG path of a bar with its top corners rounded by `r` (clamped). */
export function roundedTopBar(x, y, w, h, r) {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h}`,
    "Z",
  ].join("");
}

const TAU = Math.PI * 2;

/**
 * Ring segments for `values`, starting at three o'clock and turning
 * counter-clockwise (recharts' default, which the rings are compared
 * against), `padDegrees` between neighbours. Zero values get no segment.
 */
export function ringSegments(values, { padDegrees = 2 } = {}) {
  const total = values.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  const live = values.filter((v) => v > 0).length;
  if (total <= 0) return [];
  const pad = live > 1 ? (padDegrees * Math.PI) / 180 : 0;
  const usable = TAU - pad * live;
  const segments = [];
  let angle = 0;
  values.forEach((value, index) => {
    if (!(value > 0)) return;
    const sweep = (value / total) * usable;
    segments.push({ index, value, start: angle, end: angle + sweep });
    angle += sweep + pad;
  });
  return segments;
}

/** A point on a circle, angles counter-clockwise from three o'clock (SVG y grows down). */
function polar(cx, cy, r, angle) {
  return [cx + r * Math.cos(angle), cy - r * Math.sin(angle)];
}

/** SVG path of a ring segment between radii `r0` < `r1`. */
export function ringPath(cx, cy, r0, r1, start, end) {
  const sweep = end - start;
  if (sweep <= 0) return "";
  // A full circle cannot be one arc: split it in two halves.
  if (sweep >= TAU - 1e-6) {
    const mid = start + Math.PI;
    return ringPath(cx, cy, r0, r1, start, mid) + ringPath(cx, cy, r0, r1, mid, end);
  }
  const large = sweep > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, start);
  const [x1, y1] = polar(cx, cy, r1, end);
  const [x2, y2] = polar(cx, cy, r0, end);
  const [x3, y3] = polar(cx, cy, r0, start);
  const f = (n) => Number(n.toFixed(3));
  return [
    `M${f(x0)},${f(y0)}`,
    `A${r1},${r1} 0 ${large} 0 ${f(x1)},${f(y1)}`,
    `L${f(x2)},${f(y2)}`,
    `A${r0},${r0} 0 ${large} 1 ${f(x3)},${f(y3)}`,
    "Z",
  ].join("");
}
