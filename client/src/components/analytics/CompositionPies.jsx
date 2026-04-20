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

      <div className="mt-4 flex h-56 items-center justify-center">
        {loading ? (
          <Skeleton.Circle size={160} thickness={28} />
        ) : total === 0 ? (
          <div className="text-center text-sm text-washi-muted">
            {tFn(emptyKey)}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
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
    <div className="grid gap-6 md:grid-cols-2">
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
