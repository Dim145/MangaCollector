/*
 * 動 · Motion helpers for animations started from script (the Web
 * Animations API), which the stylesheet's reduced-motion rules never
 * reach: a tile's `element.animate()` bounce played for readers who
 * had asked for less motion.
 */

/** True when the reader asked for less motion. */
export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * A damped spring as a CSS `linear()` easing — what Material 3
 * Expressive asks of a spatial change (damping ≈ 0.9: one barely
 * visible overshoot, then rest), and never of a colour.
 *
 * `zeta` is the damping ratio, `settle` how many natural periods the
 * motion is given before it is considered at rest. Pure, so it is
 * computed once per call site.
 */
export function springEasing({ zeta = 0.9, settle = 1.6, points = 24 } = {}) {
  const omega = (2 * Math.PI) / 1; // one natural period over t ∈ [0, 1/settle]
  const at = (t) => {
    const x = t * settle;
    if (zeta < 1) {
      const wd = omega * Math.sqrt(1 - zeta * zeta);
      return (
        1 -
        Math.exp(-zeta * omega * x) *
          (Math.cos(wd * x) + ((zeta * omega) / wd) * Math.sin(wd * x))
      );
    }
    return 1 - Math.exp(-omega * x) * (1 + omega * x);
  };
  const stops = [];
  for (let i = 0; i <= points; i += 1) {
    const t = i / points;
    const value = i === points ? 1 : at(t);
    stops.push(`${Number(value.toFixed(4))} ${Number((t * 100).toFixed(2))}%`);
  }
  return `linear(${stops.join(", ")})`;
}
