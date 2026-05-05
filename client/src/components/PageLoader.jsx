import { useEffect, useId, useState } from "react";
import { useT } from "@/i18n/index.jsx";

/**
 * 待 · Page loader — a single drop of sumi spreading on washi.
 *
 * Why SVG, not CSS gradients
 * --------------------------
 * The first revision composited the puddle from a `radial-
 * gradient` with a brighter centre + box-shadow, which read as
 * a glossy 3D ball — light reflecting off a curved surface, not
 * pigment absorbed into paper. Real sumi has flat, frayed,
 * absorbed edges; the glossiness was the wrong primitive.
 *
 * The refonte is pure SVG with two filter chains:
 *
 *   • `bleed` — `feTurbulence` + `feDisplacementMap` (scale 9)
 *     + small Gaussian. Applied to the puddle and mid-wash so
 *     their edges fray inward AND outward along the noise field
 *     instead of staying perfectly circular.
 *
 *   • `soft` — same chain with higher displacement (scale 14)
 *     and a 3 px blur. Applied to the outer halo and the
 *     tendril paths so the most diffuse layer reads as paper-
 *     soaked ink rather than a clean overlay.
 *
 * Layers (back to front):
 *   1. Halo       — large soft disc, very low opacity, soft filter
 *   2. Tendrils   — five capillary paths radiating outward at 72°,
 *                   stroke-dashoffset draws them on after the
 *                   puddle has landed
 *   3. Mid wash   — middle disc at 55% alpha, bleed filter
 *   4. Puddle     — opaque flat-fill core, bleed filter (no
 *                   gradient — flat reads as absorbed pigment,
 *                   gradient would read as glossy)
 *   5. Satellites — three small dots scattered beyond the main
 *                   blob, like ink that flicked off the brush
 *   6. Kanji      — text painted on top, no filter, full
 *                   contrast against the puddle
 *
 * Sequence (~1.7 s, then breathing pulse):
 *   0.00 s   the puddle drops with an overshoot scale (0 → 1.08 → 1)
 *   0.20 s   satellites flick outward from the puddle's centre
 *   0.35 s   mid wash spreads from the puddle outward
 *   0.45 s   halo blooms behind everything
 *   0.55 s   tendrils start drawing one after another (60 ms apart)
 *   0.85 s   kanji emerges from blur and scales to 1
 *   2.00 s   the whole composition begins a slow 4 s breathing pulse
 *
 * After 3 s the supporting copy shifts to the slow-state line so
 * the screen never feels frozen on a long cold-start.
 *
 * `prefers-reduced-motion: reduce` collapses everything to the
 * settled end-state (no drop, no bloom, no tendril draw-on).
 */

// Five tendrils at 72° apart give the dispersion a star-burst feel
// without becoming busy. Each path is drawn from the puddle's edge
// outward (r0 → r1 in viewport units).
const TENDRIL_ANGLES = [-90, -18, 54, 126, 198];

// Three satellites at irregular angles + radii. Hand-tuned so the
// composition feels random rather than mechanically symmetrical.
const SATELLITES = [
  { angle: -55, radius: 76, size: 4 },
  { angle: 130, radius: 84, size: 3 },
  { angle: 38, radius: 88, size: 2.5 },
];

const STAGE = 240; // SVG viewBox is 240×240; centre is (120, 120)
const CENTER = STAGE / 2;
const PUDDLE_R = 34;
const TENDRIL_R0 = 36; // Tendrils start just past the puddle edge.
const TENDRIL_R1 = 102; // Tendrils end well into the bloom area.

export default function PageLoader({
  message,
  kanji = "印",
  fullscreen = false,
}) {
  const [slow, setSlow] = useState(false);
  const t = useT();
  const label = message ?? t("loader.preparing");

  // SVG filter ids must be unique per instance so the turbulence
  // seeds don't lock in step across multiple loaders. `useId` gives
  // us a stable SSR-safe id; we sanitise the colon (which appears
  // in React 18's `useId` output) since SVG ids can't contain it.
  const id = useId().replaceAll(":", "-");
  const bleedId = `sumi-bleed-${id}`;
  const softId = `sumi-soft-${id}`;

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        fullscreen
          ? "fixed inset-0 isolate grain"
          : "relative isolate grain min-h-[60vh]"
      }
      style={
        fullscreen
          ? {
              zIndex: 50,
              background:
                "radial-gradient(ellipse at 50% 50%, var(--bg-glow-red), transparent 65%), var(--background)",
            }
          : undefined
      }
    >
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-7 px-6 text-center">
        <svg
          viewBox={`0 0 ${STAGE} ${STAGE}`}
          aria-hidden="true"
          className="loader-sumi-svg h-56 w-56 overflow-visible"
        >
          <defs>
            {/* `bleed` — the workhorse filter. feTurbulence
                generates a 1-octave fractal noise; feDisplacementMap
                pushes each pixel by up to ±9 units along that noise
                field; a half-pixel Gaussian softens the displaced
                outline so it reads as paper bleed, not pixelation.
                Filter region is generously oversized (-30%/160%) so
                the displacement can push pixels outside the source
                bounding box without getting clipped.

                Reduced from 2 octaves → 1 octave: the 2-octave
                noise produced a slightly richer fibre but the
                rasterisation cost roughly doubles. At the loader's
                size + viewport scale the eye doesn't read the
                second octave as detail anyway. ~50% cheaper per
                frame, visually indistinguishable. */}
            <filter
              id={bleedId}
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
              filterUnits="objectBoundingBox"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.018"
                numOctaves="1"
                seed="3"
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="9"
                xChannelSelector="R"
                yChannelSelector="G"
                result="displaced"
              />
              <feGaussianBlur in="displaced" stdDeviation="0.7" />
            </filter>
            {/* `soft` — heavier displacement + a 3 px blur. Used on
                the outer halo so the most diffuse layer reads as
                wet bleed rather than a clean disc. Same 1-octave
                tuning rationale as `bleed`. */}
            <filter
              id={softId}
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
              filterUnits="objectBoundingBox"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.024"
                numOctaves="1"
                seed="7"
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="14"
                xChannelSelector="R"
                yChannelSelector="G"
                result="displaced"
              />
              <feGaussianBlur in="displaced" stdDeviation="3" />
            </filter>
          </defs>

          {/* Group everything so the breathing pulse animates the
              whole composition together, not each layer separately. */}
          <g
            className="loader-sumi-group"
            style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
          >
            {/* Halo — softest, most diffused layer. Sits behind
                everything; the soft filter gives it blooming edges
                that read as ink-soaked paper, not a coloured disc. */}
            <circle
              className="loader-sumi-halo"
              cx={CENTER}
              cy={CENTER}
              r="78"
              fill="var(--hanko)"
              filter={`url(#${softId})`}
              style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
            />

            {/* Tendrils — five capillary paths radiating outward at
                72° apart. stroke-dashoffset animation draws each one
                from puddle outward; staggered delays give a "branching"
                feel rather than a synchronised burst.

                NOT filtered: the previous revision applied the `soft`
                filter to this group, but a thin stroke (2.2-2.8 px)
                shows almost no displacement — most of the
                irregularity from feTurbulence is felt on filled
                shapes, not strokes. Dropping the filter saves one
                full filter chain per frame at no visible cost. */}
            <g
              className="loader-sumi-tendrils"
              stroke="var(--hanko)"
              strokeLinecap="round"
              fill="none"
            >
              {TENDRIL_ANGLES.map((angle, i) => {
                const rad = (angle * Math.PI) / 180;
                const x1 = CENTER + Math.cos(rad) * TENDRIL_R0;
                const y1 = CENTER + Math.sin(rad) * TENDRIL_R0;
                const x2 = CENTER + Math.cos(rad) * TENDRIL_R1;
                const y2 = CENTER + Math.sin(rad) * TENDRIL_R1;
                return (
                  <path
                    key={angle}
                    className="loader-sumi-tendril"
                    d={`M ${x1} ${y1} L ${x2} ${y2}`}
                    strokeWidth={2.2 + (i % 2) * 0.6}
                    style={{ animationDelay: `${0.55 + i * 0.06}s` }}
                  />
                );
              })}
            </g>

            {/* Mid wash — denser layer between halo and puddle.
                Gives the dispersion a third visual ring so the
                gradation from "wet centre" to "diffused edge"
                doesn't read as a hard step. */}
            <circle
              className="loader-sumi-wash"
              cx={CENTER}
              cy={CENTER}
              r="48"
              fill="var(--hanko)"
              filter={`url(#${bleedId})`}
              style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
            />

            {/* The puddle — opaque flat fill, irregular edge from
                the bleed filter. NO inner gradient: real sumi
                pigment is uniform; the previous gradient-based
                disc read as a glossy 3D ball. */}
            <circle
              className="loader-sumi-puddle"
              cx={CENTER}
              cy={CENTER}
              r={PUDDLE_R}
              fill="var(--hanko-deep)"
              filter={`url(#${bleedId})`}
              style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
            />

            {/* Satellites — small flicked-off droplets that scatter
                outside the main blob. Real ink dispersion always has
                these; without them the composition reads too
                composed.

                NOT filtered: at r=2.5–4 px the displacement filter's
                visible effect is negligible (the noise scale doesn't
                resolve below ~6 px of feature size). Skipping the
                filter on these tiny circles saves another full
                filter chain per frame. The bleed look on the puddle,
                wash and halo carries the aesthetic on its own. */}
            <g className="loader-sumi-satellites">
              {SATELLITES.map((sat, i) => {
                const rad = (sat.angle * Math.PI) / 180;
                const cx = CENTER + Math.cos(rad) * sat.radius;
                const cy = CENTER + Math.sin(rad) * sat.radius;
                return (
                  <circle
                    key={i}
                    className="loader-sumi-satellite"
                    cx={cx}
                    cy={cy}
                    r={sat.size}
                    fill="var(--hanko)"
                    style={{
                      animationDelay: `${0.2 + i * 0.08}s`,
                      transformOrigin: `${cx}px ${cy}px`,
                    }}
                  />
                );
              })}
            </g>

            {/* The kanji — brushed on after the puddle has landed.
                Plain text, no filter (the kanji needs to stay
                legible; the bleed effect on the surrounding ink is
                what carries the sumi-e aesthetic). */}
            <text
              className="loader-sumi-kanji"
              x={CENTER}
              y={CENTER + 18}
              textAnchor="middle"
              fontFamily="'Noto Serif JP', serif"
              fontSize="50"
              fontWeight="900"
              fill="var(--washi)"
              style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
            >
              {kanji}
            </text>
          </g>
        </svg>

        <div className="max-w-sm space-y-1.5">
          <p className="font-display text-xl italic text-washi">
            {label}
            <span className="inline-block w-[1.5ch] text-left">
              <DotsEllipsis />
            </span>
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {slow ? t("loader.slower") : t("loader.aMoment")}
          </p>
        </div>

        {/* 一 · A single brushstroke beneath the message — paints
            left-to-right at the same period as the breathing
            pulse so the two motions phase together. */}
        <span aria-hidden="true" className="loader-sumi-stroke" />
      </div>
    </div>
  );
}

function DotsEllipsis() {
  return (
    <span className="inline-flex">
      <span
        className="inline-block"
        style={{ animation: "dots-roll 1.4s infinite", animationDelay: "0ms" }}
      >
        .
      </span>
      <span
        className="inline-block"
        style={{
          animation: "dots-roll 1.4s infinite",
          animationDelay: "160ms",
        }}
      >
        .
      </span>
      <span
        className="inline-block"
        style={{
          animation: "dots-roll 1.4s infinite",
          animationDelay: "320ms",
        }}
      >
        .
      </span>
    </span>
  );
}
