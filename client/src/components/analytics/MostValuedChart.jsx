import Skeleton from "../ui/Skeleton.jsx";
import BarChartSvg from "./charts/BarChartSvg.jsx";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 高 · The chart's height, in pixels, for both the box that reserves
 * the space and the chart drawn inside it. The width follows the column
 * (`charts/useElementWidth.js`); the height is fixed so the card never
 * changes size between the skeleton, the empty state and the chart.
 */
const CHART_H = 256;

/**
 * 金 · "Most valued series" — the five series the reader spent the most
 * on. Drawn in plain SVG (`charts/BarChartSvg.jsx`): the chart library
 * it used to need weighed 92 kB gzipped, more than the page around it.
 *
 * Renders its own loading + empty branches so the parent doesn't
 * have to know which fork to mount.
 */
export default function MostValuedChart({
  data,
  loading,
  currencySetting,
}) {
  const t = useT();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
        {t("profile.topSpend")}
      </p>
      <h2 className="mt-1 font-display text-xl font-semibold text-washi">
        {t("profile.mostValued")}
      </h2>

      <div className="mt-4" style={{ height: CHART_H }}>
        {loading ? (
          <Skeleton.Bars count={5} maxHeight={230} />
        ) : data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-washi-muted">
            {t("profile.startAdding")}
          </div>
        ) : (
          <BarChartSvg
            data={data}
            value={(d) => d.totalCost}
            label={(d) => d.title}
            height={CHART_H}
            radius={6}
            grid={false}
            ariaLabel={t("profile.mostValued")}
            defs={
              <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--hanko-bright)" />
                <stop offset="100%" stopColor="var(--hanko-deep)" />
              </linearGradient>
            }
            barFill={() => "url(#bar-grad)"}
            describe={(d) =>
              `${d.fullTitle ?? d.title} · ${formatCurrency(d.totalCost, currencySetting)}`
            }
            tooltip={(d) => (
              <>
                <p className="text-washi">{d.fullTitle ?? d.title}</p>
                <p className="text-washi-muted">
                  {t("profile.tooltipSpent")} :{" "}
                  <span className="text-washi">
                    {formatCurrency(d.totalCost, currencySetting)}
                  </span>
                </p>
              </>
            )}
          />
        )}
      </div>
    </div>
  );
}
