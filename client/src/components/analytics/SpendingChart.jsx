import { useContext } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Skeleton from "../ui/Skeleton.jsx";
import SettingsContext from "@/SettingsContext.js";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Monthly spending over the last 12 months.
 *
 * Uses `volume.modified_on` as a stand-in for "purchase date" (closest
 * signal we have without pulling the paginated activity log). Bars in
 * hanko gradient, highest month highlighted gold.
 */
export default function SpendingChart({ data, loading }) {
  const { currency: currencySetting } = useContext(SettingsContext);
  const t = useT();

  const maxAmount = Math.max(...data.map((d) => d.amount), 0);
  const totalAmount = data.reduce((s, d) => s + d.amount, 0);
  const activeMonths = data.filter((d) => d.amount > 0).length;
  const avgPerActive = activeMonths > 0 ? totalAmount / activeMonths : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
        {t("analytics.spending.label")}
      </p>
      <div className="mt-1 flex items-baseline gap-3">
        <h2 className="font-display text-xl font-semibold text-washi">
          {t("analytics.spending.title")}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-washi-muted">
          {t("analytics.spending.last12")}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-washi-dim">
            {t("analytics.spending.total")}
          </p>
          <p className="font-display text-2xl font-semibold tabular-nums text-hanko-gradient">
            {formatCurrency(totalAmount, currencySetting)}
          </p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-washi-dim">
            {t("analytics.spending.avgActive")}
          </p>
          <p className="font-display text-lg font-semibold tabular-nums text-washi">
            {formatCurrency(avgPerActive, currencySetting)}
          </p>
        </div>
      </div>

      <div className="mt-4 h-56">
        {loading ? (
          <Skeleton.Bars count={12} maxHeight={200} />
        ) : totalAmount === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-washi-muted">
            {t("analytics.spending.empty")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="spend-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--hanko-bright)" />
                  <stop offset="100%" stopColor="var(--hanko-deep)" />
                </linearGradient>
                <linearGradient id="spend-grad-peak" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--gold)" />
                  <stop offset="100%" stopColor="var(--gold-muted)" />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
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
                tickFormatter={(v) => (v === 0 ? "" : String(v))}
              />
              <Tooltip
                cursor={{ fill: "var(--ink-2)", fillOpacity: 0.5 }}
                contentStyle={{
                  background: "var(--ink-1)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  fontSize: 12,
                  color: "var(--washi)",
                }}
                formatter={(value, _name, entry) => {
                  const count = entry?.payload?.count ?? 0;
                  return [
                    `${formatCurrency(value, currencySetting)} · ${t("analytics.spending.tooltipCount", { n: count })}`,
                    t("analytics.spending.tooltipLabel"),
                  ];
                }}
              />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                {data.map((d) => (
                  <Cell
                    key={d.month}
                    fill={
                      maxAmount > 0 && d.amount === maxAmount
                        ? "url(#spend-grad-peak)"
                        : "url(#spend-grad)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
