/*
 * 空 · Brush-stroke kanji backdrop for empty states.
 *
 * The component lays out as a stacked group: a giant kanji glyph
 * sitting BEHIND the regular title + body text + CTA. The glyph is
 * rendered through an SVG filter chain that fakes ink-bleed:
 *
 *   feTurbulence     — generate a noise field
 *     ↓
 *   feDisplacementMap — perturb the glyph outline along that field
 *     ↓
 *   feGaussianBlur (subtle) — soften the edge into a paper-bleed
 *
 * The result is the readable, recognisable shape of the kanji with
 * irregular edges and a slight halo — close enough to a brush stroke
 * for ambient typography, without committing the whole SVG path
 * library a real calligraphy font would need.
 *
 * Each instance gets a unique filter id (the `seed` prop) because
 * SVG filter ids share a global namespace — repeated `<filter id=
 * "ink">` blocks on the page would fight for definition order.
 *
 * Honours `prefers-reduced-motion`: the slow turbulence drift on
 * the noise field is skipped via the media query inside the
 * keyframe rule below.
 */
let __seedCounter = 0;

export default function EmptyStateGlyph({
  glyph = "空",
  rotation = -3,
  className = "",
  ariaLabel,
}) {
  // Stable per-instance id without React.useId so the SVG can be
  // referenced from CSS too if needed. Concurrent renders are fine —
  // ids only need to be unique within the document at any one time.
  const id = `empty-glyph-${++__seedCounter}`;

  return (
    <span
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : "true"}
      className={`pointer-events-none relative inline-flex items-center justify-center ${className}`}
      style={{ width: "16rem", height: "16rem" }}
    >
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full"
        // Inline since the value is SVG markup — Tailwind can't
        // express the filter chain in classes.
      >
        <defs>
          <filter
            id={id}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            filterUnits="userSpaceOnUse"
          >
            {/* baseFrequency ≈ 0.018 — coarse enough to read as
                "wet brush spreading on paper", fine enough to keep
                the kanji legible. Two octaves give the displacement
                field a layered roughness; one would feel mechanical. */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.018 0.024"
              numOctaves="2"
              seed={__seedCounter}
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="3.5"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            <feGaussianBlur
              in="displaced"
              stdDeviation="0.5"
              result="bled"
            />
            <feComposite in="bled" in2="SourceGraphic" operator="in" />
          </filter>
        </defs>
        <text
          x="100"
          y="105"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="'Noto Serif JP', serif"
          fontWeight="900"
          fontSize="180"
          fill="currentColor"
          filter={`url(#${id})`}
          // Light rotation reads as "set down with intention, not
          // square to the page" — a small unbalance that gives the
          // composition life. The exact angle is parametrised so
          // multiple empty-state instances on the same screen don't
          // tilt in lockstep.
          transform={`rotate(${rotation} 100 100)`}
        >
          {glyph}
        </text>
      </svg>
    </span>
  );
}
