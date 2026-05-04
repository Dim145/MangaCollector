import { useEffect, useRef } from "react";

/**
 * 筆 · Ink-trail cursor — sumi-e brush stroke that follows the
 * pointer over headings marked `data-ink-trail="true"`.
 *
 * Design intent
 * -------------
 * The previous iteration of this effect used `mix-blend-screen`
 * with a near-white ink colour, which produced a neon "lightsaber"
 * trail rather than a brush stroke. The user reported it didn't
 * read as ink. This rewrite trades the glow for actual sumi-e
 * brush feel:
 *
 *   • Colour is the deep hanko cinnabar (`--hanko`), the same
 *     pigment the seal stamps already use across the app — ink on
 *     washi, not laser on glass.
 *   • No blend mode. Plain alpha compositing reads as physical
 *     pigment laid on top of the page rather than emitted light.
 *   • Variable line width driven by pointer velocity:
 *       - slow drag  → wide pool (the brush hesitates, ink bleeds)
 *       - fast flick → thin tail (the brush lifts, ink starves)
 *     A floor of 2 px keeps the slowest pixel-level twitches
 *     visible; a ceiling of 14 px stops a held cursor from
 *     blooming into a blob.
 *   • Three parallel sub-strokes per segment with a tiny
 *     perpendicular jitter mimic the splayed bristles of a real
 *     brush. The middle stroke carries the bulk of the alpha;
 *     the side strokes are quieter and slightly thinner.
 *     Net effect is a fibrous edge without per-pixel noise.
 *   • Pause points (very slow movement) deposit a small radial
 *     ink dot — the puddle that forms when a brush rests.
 *   • Slow exponential fade — sumi dries over a beat, not a frame.
 *
 * Architecture
 * ------------
 * Single full-viewport `<canvas>` mounted at App level,
 * `pointer-events: none` so it never intercepts clicks. One
 * global `pointermove` listener; when the event target is inside
 * an opt-in heading, the position + timestamp lands in a ring
 * buffer. A `requestAnimationFrame` loop fades each entry's alpha
 * toward zero and re-paints every active segment per frame.
 *
 * Touch / pen / coarse-pointer devices and reduced-motion users
 * get an early-return — the canvas is never instantiated on
 * those clients.
 *
 * Opt-in: any element (typically `h1`) with `data-ink-trail`.
 * Children inherit via `closest()` so a `<span>` inside a marked
 * `<h1>` still triggers the trail.
 */

const MAX_POINTS = 48;
const MIN_DISTANCE = 2; // px — collapse micro-jitter into a single sample
const FADE_PER_FRAME = 0.024; // slower than before — ink dries gradually
const VELOCITY_PX_PER_MS_FAST = 1.6; // → thin tail
const VELOCITY_PX_PER_MS_SLOW = 0.05; // → fat wet pool
const WIDTH_FLOOR = 2;
const WIDTH_CEIL = 14;
const POOL_VELOCITY_THRESHOLD = 0.18; // below this, drop a pooling dot

export default function InkTrailCursor() {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    // Disable on coarse-pointer (touch / stylus-only) devices and on
    // reduced-motion preference. Either condition makes the effect
    // inappropriate or invisible to the user.
    const finePointer = window.matchMedia("(pointer: fine)")?.matches;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    if (!finePointer || reduced) return undefined;

    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return undefined;

    let dpr = window.devicePixelRatio || 1;
    const sizeCanvas = () => {
      dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas();

    /**
     * Resolve the ink colour from the `--hanko` CSS variable so
     * the trail honours theme switches without a JS round-trip.
     * The token is stored as `oklch(...)` in this codebase; we
     * pass it straight to `strokeStyle` and use `globalAlpha` for
     * per-segment opacity rather than composing rgba strings.
     * This way oklch / colour-space precision is preserved end
     * to end. Falls back to a saturated cinnabar if the variable
     * resolution fails (testing env without design tokens).
     */
    const resolveInkColor = () => {
      const styles = getComputedStyle(document.documentElement);
      const v = styles.getPropertyValue("--hanko").trim();
      return v || "rgb(200,35,51)";
    };
    let inkColor = resolveInkColor();

    /**
     * Each entry: { x, y, t, v, alpha }
     *   t      — timestamp (ms) used to derive instantaneous velocity.
     *   v      — px/ms velocity computed at sample time.
     *   alpha  — drains toward 0 each frame; entry drops when ≤ 0.02.
     */
    const points = [];
    let lastSample = null;

    const onMove = (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest?.("[data-ink-trail]")) return;

      const now =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      const x = e.clientX;
      const y = e.clientY;

      if (lastSample) {
        const dx = x - lastSample.x;
        const dy = y - lastSample.y;
        if (dx * dx + dy * dy < MIN_DISTANCE * MIN_DISTANCE) return;
        const dt = Math.max(1, now - lastSample.t);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const v = dist / dt; // px/ms
        points.push({ x, y, t: now, v, alpha: 0.92 });
      } else {
        points.push({ x, y, t: now, v: 0, alpha: 0.92 });
      }
      lastSample = { x, y, t: now };
      if (points.length > MAX_POINTS) points.shift();
    };

    const onLeave = () => {
      // Reset the velocity baseline so re-entry doesn't draw a
      // ghost segment across the absence.
      lastSample = null;
    };

    const onResize = () => sizeCanvas();
    const onThemeChange = () => {
      inkColor = resolveInkColor();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    window.addEventListener("resize", onResize);
    window.addEventListener("mc:theme-changed", onThemeChange);

    /**
     * Width as a function of velocity. Slow → fat (ink pools);
     * fast → thin (ink starves). Linear interpolation between
     * the two reference velocities, clamped to [floor, ceil].
     */
    const widthForVelocity = (v) => {
      if (v <= VELOCITY_PX_PER_MS_SLOW) return WIDTH_CEIL;
      if (v >= VELOCITY_PX_PER_MS_FAST) return WIDTH_FLOOR;
      const t =
        (v - VELOCITY_PX_PER_MS_SLOW) /
        (VELOCITY_PX_PER_MS_FAST - VELOCITY_PX_PER_MS_SLOW);
      return WIDTH_CEIL - t * (WIDTH_CEIL - WIDTH_FLOOR);
    };

    /**
     * Draw one stroke segment as three parallel sub-strokes with
     * a tiny perpendicular offset. The middle stroke carries the
     * bulk of the alpha; the two side strokes are quieter and
     * thinner — the ensemble reads as a frayed brush edge rather
     * than a clean tube.
     */
    const drawSegment = (a, b, segAlpha, width) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      // Perpendicular unit vector (right-hand rule). Used to fan
      // the side bristles outward from the centreline.
      const px = -dy / len;
      const py = dx / len;
      const offset = Math.max(0.6, width * 0.22);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = inkColor;

      // Middle stroke — carries the bulk of the ink.
      ctx.globalAlpha = segAlpha;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();

      // Two side bristles. Lower alpha, narrower, slightly
      // displaced perpendicular to the stroke direction. This
      // gives the splayed brush-hair edge without per-pixel noise.
      const sideWidth = Math.max(0.7, width * 0.55);
      ctx.globalAlpha = segAlpha * 0.42;
      ctx.lineWidth = sideWidth;

      ctx.beginPath();
      ctx.moveTo(a.x + px * offset, a.y + py * offset);
      ctx.quadraticCurveTo(
        mx + px * offset,
        my + py * offset,
        b.x + px * offset,
        b.y + py * offset,
      );
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(a.x - px * offset, a.y - py * offset);
      ctx.quadraticCurveTo(
        mx - px * offset,
        my - py * offset,
        b.x - px * offset,
        b.y - py * offset,
      );
      ctx.stroke();
    };

    /**
     * Drop a small radial ink-dot at a pooling point — slow
     * movement = brush rests = ink seeps. Implemented as a soft
     * filled disc; the alpha gradient is faked via two passes
     * (a low-alpha large blob + a high-alpha small core) so we
     * don't have to compose a `radialGradient` per frame, which
     * canvas doesn't accept with custom colour-space tokens.
     */
    const drawPool = (p) => {
      ctx.fillStyle = inkColor;

      // Outer wash — ink bleed.
      ctx.globalAlpha = p.alpha * 0.22;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();

      // Inner core — the deposited drop itself.
      ctx.globalAlpha = p.alpha * 0.55;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    };

    let raf = 0;
    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Stroke segments first so pooling dots paint on top.
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        // Each segment carries the lower of the two endpoint
        // alphas so the trailing edge fades naturally.
        const segAlpha = Math.min(a.alpha, b.alpha);
        if (segAlpha <= 0.02) continue;
        const width = widthForVelocity(b.v);
        drawSegment(a, b, segAlpha, width);
      }

      // Pooling dots — only the slow, recently-placed samples.
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        if (p.v < POOL_VELOCITY_THRESHOLD && p.alpha > 0.4) {
          drawPool(p);
        }
      }

      // Reset alpha for the next frame's first paint.
      ctx.globalAlpha = 1;

      // Drain the buffer.
      for (let i = 0; i < points.length; i += 1) {
        points[i].alpha -= FADE_PER_FRAME;
      }
      while (points.length > 0 && points[0].alpha <= 0.02) {
        points.shift();
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mc:theme-changed", onThemeChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      // Sits above content but below modals (z-50). Pointer-events
      // disabled so clicks pass through. NO mix-blend-mode: the
      // previous version used `screen` which made the trail glow
      // like a laser. Sumi-e is opaque pigment; alpha compositing
      // reads as physical ink rather than emitted light.
      className="pointer-events-none fixed inset-0 z-40"
    />
  );
}
