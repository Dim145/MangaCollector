import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import Skeleton from "../ui/Skeleton.jsx";
import { useT } from "@/i18n/index.jsx";

/**
 * 高 · The chart's height, in pixels, for both the box that reserves
 * the space and the chart drawn inside it.
 *
 * A number, not `"100%"`, and that is the point. `ResponsiveContainer`
 * starts at a size of -1 × -1 and only learns better from a
 * `ResizeObserver` it attaches in an effect — so on its first render it
 * warns, into the console of anyone who opens /stats:
 *
 *     The width(-1) and height(-1) of chart should be greater than 0
 *
 * Nothing about the parent can prevent that; the element being measured
 * does not exist yet. But the check is an OR over the two axes, so a
 * height it does not have to measure satisfies it. The width stays
 * `"100%"` and still follows the column.
 */
const CHART_H = 224;

/**
 * Palette that rotates through the Shōjo Noir accent colours. Reused across
 * pies so stores and genres share a consistent visual language — the user
 * stops associating a colour with a specific meaning and starts reading the
 * chart as a whole.
 */
const PALETTE = [
  "var(--hanko)",
  "var(--gold)",
  "var(--hanko-bright)",
  "var(--gold-muted)",
  "var(--hanko-deep)",
  "var(--washi)",
  "var(--washi-muted)",
  "var(--washi-dim)",
];

function PieCard({ title, label, data, loading, tFn, emptyKey }) {
  const total = data.reduce((s, d) => s + (d.count ?? d.value ?? 0), 0);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
      </p>
      <h3 className="mt-1 font-display text-xl font-semibold text-washi">
        {title}
      </h3>

      {/* 枠 · A plain block, not a centred flex box: `items-center`
          made the chart a flex item whose height came from its content,
          so `height: 100%` had nothing to resolve against. The two
          placeholders centre themselves instead. */}
      <div className="mt-4" style={{ height: CHART_H }}>
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Skeleton.Circle size={160} thickness={28} />
          </div>
        ) : total === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-washi-muted">
            {tFn(emptyKey)}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={CHART_H}>
            <PieChart>
              <Pie
                data={data}
                dataKey={data[0]?.count != null ? "count" : "value"}
                nameKey="name"
                innerRadius={52}
                outerRadius={82}
                paddingAngle={2}
                stroke="none"
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip
                cursor={false}
                contentStyle={{
                  background: "var(--ink-1)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  fontSize: 12,
                  color: "var(--washi)",
                }}
                formatter={(value, name) => [
                  `${value} (${((value / total) * 100).toFixed(0)}%)`,
                  name,
                ]}
              />
              <Legend
                verticalAlign="bottom"
                height={28}
                iconSize={8}
                iconType="circle"
                wrapperStyle={{ fontSize: 11, color: "var(--washi-muted)" }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default function CompositionPies({ stores, genres, loading }) {
  const t = useT();

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <PieCard
        label={t("analytics.genres.label")}
        title={t("analytics.genres.title")}
        data={genres}
        loading={loading}
        tFn={t}
        emptyKey="analytics.genres.empty"
      />
      <PieCard
        label={t("analytics.stores.label")}
        title={t("analytics.stores.title")}
        data={stores.slice(0, 8).map((s) => ({ name: s.name, count: s.count }))}
        loading={loading}
        tFn={t}
        emptyKey="analytics.stores.empty"
      />
    </div>
  );
}
