/*
 * Skeleton primitives — brushstroke wash rather than generic SaaS shimmer.
 *
 * The wash is a short linear gradient of hanko red that sweeps across the
 * placeholder, inspired by sumi-e ink fading across washi paper. Variants
 * are provided for the shapes that actually appear in our UI (stat numbers,
 * manga covers, donut chart, bar chart) so calling sites stay expressive:
 *
 *   <Skeleton.Stat />
 *   <Skeleton.Card />
 *   <Skeleton.Circle size={190} />
 *   <Skeleton.Bars count={5} />
 */

export default function Skeleton({ className = "", style, ...rest }) {
  return (
    <span
      aria-hidden="true"
      className={`mc-skeleton inline-block rounded-md ${className}`}
      style={style}
      {...rest}
    />
  );
}

/** Number placeholder sized to line up with font-display stats. */
function Stat({ width = "4ch", className = "" }) {
  return (
    <Skeleton
      className={`h-[0.85em] align-middle ${className}`}
      style={{ width }}
    />
  );
}

/** 2:3 manga-cover card placeholder for grid usage. */
function Card({ className = "" }) {
  return (
    <div
      aria-hidden="true"
      className={`mc-skeleton aspect-[2/3] w-full rounded-lg ${className}`}
    />
  );
}

/** Circle (donut) for Recharts pie placeholder. */
function Circle({ size = 190, thickness = 30 }) {
  const inner = size - thickness * 2;
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto"
      style={{ width: size, height: size }}
    >
      <div
        className="mc-skeleton absolute inset-0 rounded-full"
        style={{ animationDuration: "2.4s" }}
      />
      <div
        className="absolute rounded-full bg-card"
        style={{
          width: inner,
          height: inner,
          top: thickness,
          left: thickness,
        }}
      />
    </div>
  );
}

/** Vertical bars placeholder for Recharts bar chart. */
function Bars({ count = 5, maxHeight = 180 }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-full items-end justify-between gap-3 px-2"
      style={{ minHeight: maxHeight }}
    >
      {Array.from({ length: count }).map((_, i) => {
        // Organic varied heights, deterministic per index
        const h = 35 + ((i * 53) % 60);
        return (
          <div
            key={i}
            className="mc-skeleton flex-1 rounded-t-md"
            style={{
              height: `${h}%`,
              animationDelay: `${i * 90}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

/** Thin horizontal bar for progress-like UI. */
function Bar({ className = "" }) {
  return (
    <Skeleton
      className={`block h-1.5 w-full rounded-full ${className}`}
    />
  );
}

Skeleton.Stat = Stat;
Skeleton.Card = Card;
Skeleton.Circle = Circle;
Skeleton.Bars = Bars;
Skeleton.Bar = Bar;
