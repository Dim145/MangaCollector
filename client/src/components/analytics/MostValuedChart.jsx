import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Skeleton from "../ui/Skeleton.jsx";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 金 · "Most valued series" — five tallest spend bars on the
 * profile page. Lifted out of ProfilePage so the recharts chunk
 * (380 KB / 110 KB gzipped) can be lazy-imported alongside the
 * other analytics widgets — visiting /profile no longer pays for
 * the chart library before any chart is in viewport.
 *
 * Renders its own loading + empty branches so the parent doesn't
 * have to know which fork to mount; that's how `<Suspense>` can
 * route through the lazy loader without juggling intermediate
 * skeletons in the page itself.
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

      <div className="mt-4 h-64">
        {loading ? (
          <Skeleton.Bars count={5} maxHeight={230} />
        ) : data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-washi-muted">
            {t("profile.startAdding")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <defs>
                <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--hanko-bright)" />
                  <stop offset="100%" stopColor="var(--hanko-deep)" />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="title"
                stroke="var(--washi-dim)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="var(--washi-dim)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--ink-2)", fillOpacity: 0.6 }}
                contentStyle={{
                  background: "var(--ink-1)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  fontSize: 12,
                  color: "var(--washi)",
                }}
                formatter={(value) => [
                  formatCurrency(value, currencySetting),
                  t("profile.tooltipSpent"),
                ]}
                labelFormatter={(_, pl) => pl?.[0]?.payload?.fullTitle ?? ""}
              />
              <Bar
                dataKey="totalCost"
                fill="url(#bar-grad)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
