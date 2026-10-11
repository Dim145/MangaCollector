import { useId, useRef, useState } from "react";
import { ringPath, ringSegments } from "./scale.js";
import { useElementWidth } from "./useElementWidth.js";

/**
 * 輪 · A ring chart in plain SVG with its legend — the two composition
 * rings of the stats page (genres, shops). Same keyboard and
 * screen-reader contract as `BarChartSvg`: one tab stop, arrows between
 * segments, a polite live region, a hidden table of every value.
 *
 * The segment under the pointer (or the arrow keys) is read in the
 * ring's hole — its name, its count and its share — rather than in a
 * tooltip that would cover the ring it describes.
 */
const LEGEND_H = 32;

export default function RingChartSvg({
  data,
  height,
  innerRadius = 52,
  outerRadius = 82,
  palette,
  describe,
  ariaLabel,
}) {
  const [ref, width] = useElementWidth();
  const [active, setActive] = useState(null);
  const pointerFocus = useRef(false);
  const liveId = useId();
  const total = data.reduce((s, d) => s + (d.value > 0 ? d.value : 0), 0);
  const share = (d) => (total > 0 ? Math.round((d.value / total) * 100) : 0);
  const segments = ringSegments(data.map((d) => d.value));
  const chartH = Math.max(0, height - LEGEND_H);
  const cx = width / 2;
  const cy = chartH / 2;
  const text = (d) => describe(d, share(d));
  const color = (i) => palette[i % palette.length];

  const onKeyDown = (event) => {
    if (!segments.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const order = segments.map((s) => s.index);
      const step = event.key === "ArrowRight" ? 1 : -1;
      setActive((cur) => {
        const pos = cur == null ? -1 : order.indexOf(cur);
        return order[(pos + step + order.length) % order.length];
      });
    } else if (event.key === "Escape") {
      setActive(null);
    }
  };

  const activeDatum = active != null ? data[active] : null;

  return (
    <div
      ref={ref}
      className="relative h-full w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-hanko/60"
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
      aria-describedby={liveId}
      onKeyDown={onKeyDown}
      onPointerDown={() => {
        pointerFocus.current = true;
      }}
      onFocus={() => {
        if (!pointerFocus.current) {
          setActive((cur) => cur ?? segments[0]?.index ?? null);
        }
        pointerFocus.current = false;
      }}
      onBlur={() => setActive(null)}
    >
      {width > 0 && (
        <svg width={width} height={chartH} aria-hidden="true" className="block select-none">
          {segments.map((s) => (
            <path
              key={s.index}
              d={ringPath(
                cx,
                cy,
                innerRadius,
                active === s.index ? outerRadius + 4 : outerRadius,
                s.start,
                s.end,
              )}
              fill={color(s.index)}
              className="transition-[d] duration-150 motion-reduce:transition-none"
              onPointerEnter={() => setActive(s.index)}
              onPointerDown={() => setActive(s.index)}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") setActive(null);
              }}
            />
          ))}
        </svg>
      )}
      {activeDatum && width > 0 && (
        <div
          className="pointer-events-none absolute flex flex-col items-center justify-center text-center"
          style={{
            left: cx - innerRadius + 6,
            top: cy - innerRadius + 6,
            width: (innerRadius - 6) * 2,
            height: (innerRadius - 6) * 2,
          }}
        >
          <span className="w-full truncate text-[11px] text-washi-muted">
            {activeDatum.name}
          </span>
          <span className="font-display text-lg font-semibold tabular-nums text-washi">
            {activeDatum.value}
          </span>
          <span className="font-mono text-[10px] text-washi-dim">
            {share(activeDatum)}%
          </span>
        </div>
      )}
      <ul
        className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-washi-muted"
        style={{ minHeight: LEGEND_H }}
        aria-hidden="true"
      >
        {data.map((d, i) => (
          <li key={i} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: color(i) }}
            />
            {d.name}
          </li>
        ))}
      </ul>
      <p id={liveId} className="sr-only" aria-live="polite">
        {activeDatum ? text(activeDatum) : ""}
      </p>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <td>{text(d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
