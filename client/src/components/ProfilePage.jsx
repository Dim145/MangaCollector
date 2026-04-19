import { useContext, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DefaultBackground from "./DefaultBackground";
import SettingsContext from "@/SettingsContext.js";
import { getAllVolumes } from "../utils/volume";
import { getUserLibrary } from "../utils/user";
import { formatCurrency } from "@/utils/price.js";

export default function ProfilePage({ googleUser }) {
  const [totalSeries, setTotalSeries] = useState(0);
  const [totalVolumes, setTotalVolumes] = useState(0);
  const [totalVolumesOwned, setTotalVolumesOwned] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [completionRate, setCompletionRate] = useState(0);
  const [seriesByCost, setSeriesByCost] = useState([]);
  const [loading, setLoading] = useState(true);
  const { currency: currencySetting } = useContext(SettingsContext);

  const completionData = [
    { name: "Owned", value: completionRate },
    { name: "Missing", value: Math.max(0, 100 - completionRate) },
  ];

  useEffect(() => {
    (async () => {
      try {
        const [library, volumeData] = await Promise.all([
          getUserLibrary(),
          getAllVolumes(),
        ]);

        setTotalSeries(library.length);
        setTotalVolumes(volumeData.length);

        let totalOwnedCounter = 0;
        let totalCostCounter = 0;
        const costMap = {};
        const titleMap = {};
        for (const series of library) titleMap[series.mal_id] = series.name;

        for (const vol of volumeData) {
          if (vol.owned) {
            totalOwnedCounter += 1;
            totalCostCounter += Number(vol.price);
            const title = titleMap[vol.mal_id] || "Unknown";
            if (!costMap[title]) costMap[title] = 0;
            costMap[title] += Number(vol.price);
          }
        }

        setTotalVolumesOwned(totalOwnedCounter);
        setTotalCost(totalCostCounter);
        setCompletionRate(
          volumeData.length > 0
            ? Number(((totalOwnedCounter / volumeData.length) * 100).toFixed(1))
            : 0
        );

        const sorted = Object.entries(costMap)
          .map(([title, cost]) => ({
            title: title.split(" ").slice(0, 2).join(" ").slice(0, 12),
            fullTitle: title,
            totalCost: Number(cost.toFixed(2)),
          }))
          .sort((a, b) => b.totalCost - a.totalCost)
          .slice(0, 5);
        setSeriesByCost(sorted);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const userName = googleUser?.name ?? "Reader";

  return (
    <DefaultBackground>
      <div className="mx-auto max-w-6xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* Header */}
        <header className="mb-10 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
              PROFILE · 統計
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h1 className="mt-2 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-5xl">
            Hello,{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {userName}
            </span>
          </h1>
          <p className="mt-2 text-sm text-washi-muted">
            Your archive at a glance — curated with care, volume by volume.
          </p>
        </header>

        {/* Hero stat block */}
        <section className="mb-8 grid gap-4 animate-fade-up sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat
            label="Series"
            value={totalSeries}
            hint="In archive"
            loading={loading}
          />
          <HeroStat
            label="Volumes"
            value={`${totalVolumesOwned}`}
            sub={`/ ${totalVolumes}`}
            hint="Owned / tracked"
            accent="hanko"
            loading={loading}
          />
          <HeroStat
            label="Invested"
            value={formatCurrency(totalCost, currencySetting)}
            hint="Total collection value"
            accent="gold"
            loading={loading}
          />
          <HeroStat
            label="Completion"
            value={`${completionRate}%`}
            hint="Of tracked volumes"
            loading={loading}
          />
        </section>

        {/* Charts */}
        <section className="mb-8 grid gap-6 animate-fade-up md:grid-cols-2" style={{ animationDelay: "200ms" }}>
          {/* Donut */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
              Completion rate
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-washi">
              Progression
            </h2>

            <div className="relative mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={completionData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={65}
                    outerRadius={95}
                    paddingAngle={3}
                    stroke="none"
                  >
                    <Cell fill="oklch(0.6 0.22 25)" />
                    <Cell fill="oklch(0.21 0.012 28)" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className="font-display text-4xl font-semibold tabular-nums text-hanko-gradient">
                  {completionRate}%
                </p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                  complete
                </p>
              </div>
            </div>
          </div>

          {/* Bar */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
              Top spend
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-washi">
              Most valued series
            </h2>

            <div className="mt-4 h-64">
              {seriesByCost.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={seriesByCost}>
                    <defs>
                      <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="oklch(0.68 0.24 25)" />
                        <stop offset="100%" stopColor="oklch(0.48 0.2 25)" />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="title"
                      stroke="oklch(0.58 0.015 60)"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="oklch(0.58 0.015 60)"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "oklch(0.21 0.012 28 / 0.6)" }}
                      contentStyle={{
                        background: "oklch(0.11 0.008 30)",
                        border: "1px solid oklch(0.96 0.012 85 / 0.1)",
                        borderRadius: "0.5rem",
                        fontSize: 12,
                        color: "oklch(0.96 0.012 85)",
                      }}
                      formatter={(value) => [
                        formatCurrency(value, currencySetting),
                        "Spent",
                      ]}
                      labelFormatter={(_, pl) =>
                        pl?.[0]?.payload?.fullTitle ?? ""
                      }
                    />
                    <Bar
                      dataKey="totalCost"
                      fill="url(#bar-grad)"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-washi-muted">
                  Start adding owned volumes with a price to see trends.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Insight card */}
        <section className="animate-fade-up" style={{ animationDelay: "350ms" }}>
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-hanko/10 via-ink-1/50 to-gold/5 p-6 backdrop-blur md:p-8">
            <div className="pointer-events-none absolute -right-10 -top-10 grid h-40 w-40 place-items-center opacity-20">
              <span className="font-display text-[10rem] italic leading-none text-hanko">
                ⟡
              </span>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
              Insight
            </p>
            <h3 className="mt-2 max-w-xl font-display text-xl font-semibold italic text-washi md:text-2xl">
              {totalVolumesOwned === 0
                ? "Start collecting to see your journey unfold."
                : completionRate === 100
                  ? "A completionist's dream — every series in perfect harmony."
                  : completionRate > 75
                    ? "You're so close. Less than a quarter separates you from a complete archive."
                    : completionRate > 50
                      ? "Over halfway there — your shelves are filling up beautifully."
                      : "Every collection starts with a single volume. You're building something special."}
            </h3>
            <p className="mt-2 max-w-xl text-sm text-washi-muted">
              Activity feed & personalized recommendations coming soon.
            </p>
          </div>
        </section>
      </div>
    </DefaultBackground>
  );
}

function HeroStat({ label, value, sub, hint, accent, loading }) {
  const accentClass =
    accent === "hanko"
      ? "text-hanko-bright"
      : accent === "gold"
        ? "text-gold"
        : "text-washi";
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-5 backdrop-blur transition hover:border-hanko/30">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
      </p>
      {loading ? (
        <div className="mt-3 h-9 w-24 animate-shimmer rounded" />
      ) : (
        <p
          className={`mt-2 font-display text-3xl font-semibold tabular-nums md:text-4xl ${accentClass}`}
        >
          {value}
          {sub && (
            <span className="ml-1 font-mono text-sm font-normal text-washi-dim">
              {sub}
            </span>
          )}
        </p>
      )}
      {hint && (
        <p className="mt-1 text-[11px] text-washi-muted">{hint}</p>
      )}
      <div className="pointer-events-none absolute -bottom-6 -right-6 h-16 w-16 rounded-full bg-hanko/10 blur-2xl opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
