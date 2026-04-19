import { lazy, Suspense, useContext, useMemo, useState } from "react";
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
import Skeleton from "./ui/Skeleton.jsx";
import ActivityFeed from "./ActivityFeed.jsx";
import MalRecommendations from "./MalRecommendations.jsx";
// Modal — only needed on click, deferred so it doesn't bloat the profile chunk.
const AvatarPicker = lazy(() => import("./AvatarPicker.jsx"));
import SettingsContext from "@/SettingsContext.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { useUserSettings } from "@/hooks/useSettings.js";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

export default function ProfilePage({ googleUser }) {
  const { currency: currencySetting } = useContext(SettingsContext);
  const { data: library, isInitialLoad: loadingLib } = useLibrary();
  const { data: volumes, isInitialLoad: loadingVol } = useAllVolumes();
  const { data: settings } = useUserSettings();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const t = useT();

  const loading = loadingLib || loadingVol;

  const { totalSeries, totalVolumes, totalVolumesOwned, totalCost, completionRate, seriesByCost } =
    useMemo(() => {
      const totalSeries = library.length;
      const totalVolumes = volumes.length;
      const titleMap = {};
      for (const series of library) titleMap[series.mal_id] = series.name;

      let owned = 0;
      let cost = 0;
      const costMap = {};

      for (const vol of volumes) {
        if (vol.owned) {
          owned += 1;
          cost += Number(vol.price) || 0;
          const title = titleMap[vol.mal_id] || "Unknown";
          if (!costMap[title]) costMap[title] = 0;
          costMap[title] += Number(vol.price) || 0;
        }
      }

      const completion =
        totalVolumes > 0
          ? Number(((owned / totalVolumes) * 100).toFixed(1))
          : 0;

      const sorted = Object.entries(costMap)
        .map(([title, c]) => ({
          title: title.split(" ").slice(0, 2).join(" ").slice(0, 12),
          fullTitle: title,
          totalCost: Number(c.toFixed(2)),
        }))
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, 5);

      return {
        totalSeries,
        totalVolumes,
        totalVolumesOwned: owned,
        totalCost: cost,
        completionRate: completion,
        seriesByCost: sorted,
      };
    }, [library, volumes]);

  const completionData = [
    { name: "Owned", value: completionRate },
    { name: "Missing", value: Math.max(0, 100 - completionRate) },
  ];

  const userName = googleUser?.name ?? t("profile.reader");
  const initial = userName?.[0]?.toUpperCase() ?? "U";
  const avatarUrl = !avatarFailed ? settings?.avatarUrl ?? null : null;

  return (
    <DefaultBackground>
      <div className="mx-auto max-w-6xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        <header className="mb-10 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
              {t("profile.profile")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>

          <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-center">
            {/* Avatar — click to open picker */}
            <button
              onClick={() => setPickerOpen(true)}
              aria-label={t("avatar.changeAria")}
              className={`group relative h-20 w-20 shrink-0 overflow-hidden rounded-full ring-1 ring-border transition-all hover:ring-hanko hover:shadow-[0_0_32px_rgba(220,38,38,0.35)] md:h-24 md:w-24 ${
                avatarUrl ? "bg-ink-2" : "bg-gradient-to-br from-gold to-gold-muted"
              }`}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <span className="absolute inset-0 grid place-items-center font-display text-3xl font-bold text-ink-0 md:text-4xl">
                  {initial}
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-ink-0/60 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-6 w-6 text-washi"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </span>
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-5xl">
                {t("profile.helloName")}{" "}
                <span className="text-hanko-gradient font-semibold not-italic">
                  {userName}
                </span>
              </h1>
              <p className="mt-2 text-sm text-washi-muted">
                {t("profile.byline")}
              </p>
            </div>
          </div>
        </header>

        {pickerOpen && (
          <Suspense fallback={null}>
            <AvatarPicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
            />
          </Suspense>
        )}

        <section className="mb-8 grid gap-4 animate-fade-up sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat
            label={t("profile.series")}
            value={totalSeries}
            hint={t("profile.inArchive")}
            loading={loading}
          />
          <HeroStat
            label={t("profile.volumes")}
            value={`${totalVolumesOwned}`}
            sub={`/ ${totalVolumes}`}
            hint={t("profile.ownedTracked")}
            accent="hanko"
            loading={loading}
          />
          <HeroStat
            label={t("profile.invested")}
            value={formatCurrency(totalCost, currencySetting)}
            hint={t("profile.totalValue")}
            accent="gold"
            loading={loading}
          />
          <HeroStat
            label={t("profile.completion")}
            value={`${completionRate}%`}
            hint={t("profile.ofTracked")}
            loading={loading}
          />
        </section>

        <section className="mb-8 grid gap-6 animate-fade-up md:grid-cols-2" style={{ animationDelay: "200ms" }}>
          <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
              {t("profile.completionRateLabel")}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-washi">
              {t("profile.progression")}
            </h2>

            <div className="relative mt-4 flex h-64 items-center justify-center">
              {loading ? (
                <>
                  <Skeleton.Circle size={190} thickness={30} />
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                    <Skeleton className="h-6 w-16" />
                    <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                      complete
                    </p>
                  </div>
                </>
              ) : (
                <>
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
                        <Cell fill="var(--hanko)" />
                        <Cell fill="var(--ink-2)" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <p className="font-display text-4xl font-semibold tabular-nums text-hanko-gradient">
                      {completionRate}%
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                      {t("profile.completeShort")}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

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
              ) : seriesByCost.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-washi-muted">
                  {t("profile.startAdding")}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={seriesByCost}>
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
              )}
            </div>
          </div>
        </section>

        <section className="animate-fade-up" style={{ animationDelay: "350ms" }}>
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-hanko/10 via-ink-1/50 to-gold/5 p-6 backdrop-blur md:p-8">
            <div className="pointer-events-none absolute -right-10 -top-10 grid h-40 w-40 place-items-center opacity-20">
              <span className="font-display text-[10rem] italic leading-none text-hanko">
                ⟡
              </span>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
              {t("profile.insightLabel")}
            </p>
            <h3 className="mt-2 max-w-xl font-display text-xl font-semibold italic text-washi md:text-2xl">
              {totalVolumesOwned === 0
                ? t("profile.insightEmpty")
                : completionRate === 100
                  ? t("profile.insightComplete")
                  : completionRate > 75
                    ? t("profile.insightAlmost")
                    : completionRate > 50
                      ? t("profile.insightHalfway")
                      : t("profile.insightBeginning")}
            </h3>
          </div>
        </section>

        <section
          className="mt-8 animate-fade-up"
          style={{ animationDelay: "450ms" }}
        >
          <ActivityFeed limit={20} />
        </section>

        <section
          className="mt-8 animate-fade-up"
          style={{ animationDelay: "550ms" }}
        >
          <MalRecommendations />
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
      <p
        className={`mt-2 font-display text-3xl font-semibold tabular-nums md:text-4xl ${accentClass}`}
      >
        {loading ? (
          <Skeleton.Stat width="5ch" />
        ) : (
          <>
            {value}
            {sub && (
              <span className="ml-1 font-mono text-sm font-normal text-washi-dim">
                {sub}
              </span>
            )}
          </>
        )}
      </p>
      {hint && (
        <p className="mt-1 text-[11px] text-washi-muted">{hint}</p>
      )}
      <div className="pointer-events-none absolute -bottom-6 -right-6 h-16 w-16 rounded-full bg-hanko/10 blur-2xl opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
