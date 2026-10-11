import { useId, useMemo, useRef, useState } from "react";
import { bandLayout, niceTicks, roundedTopBar } from "./scale.js";
import { useElementWidth } from "./useElementWidth.js";

/**
 * 柱 · A bar chart in plain SVG — what the stats page's three bar charts
 * needed from recharts and nothing else: round ticks, a dashed grid,
 * bars with rounded tops, a hover band and a tooltip.
 *
 * Reachable without a mouse: the chart is one tab stop, the arrow keys
 * move between bars (the tooltip follows and a polite live region reads
 * it), and a visually hidden table carries every value for a screen
 * reader. `describe(d)` is the one-line text of a bar for both. Focus
 * from the keyboard opens on the first bar; a click opens on the bar
 * under the pointer instead.
 */
const MARGIN = { top: 10, right: 8, bottom: 22 };
const TICK_FONT = 10;

export default function BarChartSvg({
  data,
  value,
  label,
  height,
  barFill,
  defs,
  radius = 4,
  integers = false,
  grid = true,
  formatTick = (v) => String(v),
  tooltip,
  describe,
  ariaLabel,
}) {
  const [ref, width] = useElementWidth();
  const [active, setActive] = useState(null);
  const pointerFocus = useRef(false);
  const liveId = useId();

  // A missing or negative amount draws as an empty band, never as NaN.
  const values = data.map((d) => {
    const v = Number(value(d));
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  const ticks = useMemo(
    () => niceTicks(Math.max(0, ...values), { count: 4, integers }),
    // `values` is derived from `data`; recomputing on `data` is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, integers],
  );
  const tickLabels = ticks.map((t) => formatTick(t));
  const axisWidth = Math.max(
    18,
    Math.ceil(Math.max(...tickLabels.map((s) => s.length)) * TICK_FONT * 0.62) + 8,
  );
  const left = axisWidth;
  const plotWidth = Math.max(0, width - left - MARGIN.right);
  const plotHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const top = ticks.at(-1) || 1;
  const y = (v) => MARGIN.top + plotHeight - (v / top) * plotHeight;
  const { band, bar, x } = bandLayout(data.length, plotWidth, { gap: 0.2 });

  // Thin the labels when the bands are narrower than a label is wide.
  const labelEvery = Math.max(
    1,
    Math.ceil(
      (Math.max(...data.map((d) => String(label(d)).length), 1) * TICK_FONT * 0.62 + 6) /
        Math.max(band, 1),
    ),
  );

  const text = (d) => (describe ? describe(d) : `${label(d)}: ${value(d)}`);
  const at = (clientX, rect) => {
    const i = Math.floor((clientX - rect.left - left) / Math.max(band, 1));
    return i >= 0 && i < data.length ? i : null;
  };

  const onKeyDown = (event) => {
    if (!data.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      setActive((cur) =>
        cur == null ? 0 : (cur + step + data.length) % data.length,
      );
    } else if (event.key === "Escape") {
      setActive(null);
    }
  };

  const activeDatum = active != null ? data[active] : null;
  // The tooltip hangs above its bar; near an edge it is anchored by its
  // own edge rather than its middle, so it never leaves the chart.
  const tipX = active != null ? left + x(active) + bar / 2 : 0;
  const tipTop = active != null ? y(values[active]) : 0;
  const tipAnchor =
    tipX < width / 3
      ? { left: Math.max(tipX - 12, 0), transform: "translate(0, -100%)" }
      : tipX > (width * 2) / 3
        ? { right: Math.max(width - tipX - 12, 0), transform: "translate(0, -100%)" }
        : { left: tipX, transform: "translate(-50%, -100%)" };

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
        if (!pointerFocus.current) setActive((cur) => cur ?? 0);
        pointerFocus.current = false;
      }}
      onBlur={() => setActive(null)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          aria-hidden="true"
          className="block select-none"
          onPointerMove={(e) => setActive(at(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerDown={(e) => setActive(at(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setActive(null);
          }}
        >
          {defs && <defs>{defs}</defs>}
          {grid &&
            ticks.map((t) => (
              <line
                key={`g${t}`}
                x1={left}
                x2={left + plotWidth}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
            ))}
          {ticks.map((t, i) => (
            <text
              key={`t${t}`}
              x={left - 6}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              fill="var(--washi-dim)"
              fontSize={TICK_FONT}
              fontFamily="var(--font-mono)"
            >
              {tickLabels[i]}
            </text>
          ))}
          {active != null && (
            <rect
              x={left + active * band}
              y={MARGIN.top}
              width={band}
              height={plotHeight}
              fill="var(--ink-2)"
              opacity={0.5}
            />
          )}
          {data.map((d, i) => {
            const v = values[i];
            const barTop = y(v);
            return (
              <path
                key={i}
                className="mc-bar-grow"
                d={roundedTopBar(left + x(i), barTop, bar, MARGIN.top + plotHeight - barTop, radius)}
                fill={barFill(d, i)}
              />
            );
          })}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text
                key={`l${i}`}
                x={left + x(i) + bar / 2}
                y={height - 6}
                textAnchor="middle"
                fill="var(--washi-dim)"
                fontSize={TICK_FONT}
                fontFamily="var(--font-mono)"
              >
                {label(d)}
              </text>
            ) : null,
          )}
        </svg>
      )}
      {activeDatum && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-border bg-ink-1/98 px-3 py-2 font-mono text-xs shadow-xl backdrop-blur"
          style={{ ...tipAnchor, top: Math.max(tipTop - 8, 0) }}
        >
          {tooltip ? tooltip(activeDatum) : text(activeDatum)}
        </div>
      )}
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
