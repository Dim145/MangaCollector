import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { consumeTourStep, TOUR_STEPS } from "@/lib/tour.js";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CoverImage from "./ui/CoverImage.jsx";
import DefaultBackground from "./DefaultBackground";
import Skeleton from "./ui/Skeleton.jsx";
import ActivityFeed from "./ActivityFeed.jsx";
import MalRecommendations from "./MalRecommendations.jsx";
import SpendingChart from "./analytics/SpendingChart.jsx";
import ReadingChart from "./analytics/ReadingChart.jsx";
import CompositionPies from "./analytics/CompositionPies.jsx";
import InsightCards from "./analytics/InsightCards.jsx";
import ActionableLists from "./analytics/ActionableLists.jsx";
// Modal — only needed on click, deferred so it doesn't bloat the profile chunk.
const AvatarPicker = lazy(() => import("./AvatarPicker.jsx"));
import SettingsContext from "@/SettingsContext.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { useUserSettings } from "@/hooks/useSettings.js";
import { useProfileAnalytics } from "@/hooks/useProfileAnalytics.js";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

export default function ProfilePage({ googleUser }) {
  const { currency: currencySetting, adult_content_level } =
    useContext(SettingsContext);
  const { data: library, isInitialLoad: loadingLib } = useLibrary();
  const { data: volumes, isInitialLoad: loadingVol } = useAllVolumes();
  const { data: settings } = useUserSettings();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const navigate = useNavigate();
  const t = useT();

  // 印 · Welcome-tour spotlight on the avatar button.
  // When the user lands here from the tour, we light up the avatar
  // (ring pulse + floating caption) for ~7s, OR until they click — at
  // which point the natural picker open closes the spotlight in one
  // gesture. We DON'T auto-open the picker: the goal is to teach where
  // to click, not to skip the click; otherwise the user never builds
  // the muscle memory for next time.
  const avatarRef = useRef(null);
  const [tourSpotlight, setTourSpotlight] = useState(false);
  useEffect(() => {
    if (consumeTourStep() !== TOUR_STEPS.AVATAR) return;
    setTourSpotlight(true);
    // Bring the button into view in case the page was scrolled when
    // the user came back to the tab. `block: 'center'` keeps the
    // caption above the button visible too.
    const raf = requestAnimationFrame(() => {
      avatarRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
    // Auto-dismiss the spotlight after the user has had a chance to
    // notice the pulse. Click-dismissal lives in the button's onClick.
    const timer = setTimeout(() => setTourSpotlight(false), 7000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);

  const loading = loadingLib || loadingVol;

  // One-shot analytics bundle — everything derives from library + volumes
  // already in memory, so no extra network round-trip. Components below
  // receive their own slice via props.
  const analytics = useProfileAnalytics();

  const {
    totalSeries,
    totalVolumes,
    totalVolumesOwned,
    totalCost,
    completionRate,
    seriesByCost,
  } = useMemo(() => {
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
      totalVolumes > 0 ? Number(((owned / totalVolumes) * 100).toFixed(1)) : 0;

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

  // Top 5 series closest to completion — replaces the previous donut chart,
  // which surfaced a single global percentage already shown in the stat strip.
  // The list keeps every pixel earning its keep: cover, title, progress bar,
  // and a "X to go" tail. One row = one actionable target.
  const inProgress = useMemo(() => {
    const rows = [];
    for (const m of library ?? []) {
      const total = m.volumes ?? 0;
      const owned = m.volumes_owned ?? 0;
      if (total > 0 && owned > 0 && owned < total) {
        rows.push({
          mal_id: m.mal_id,
          manga: m,
          title: m.name,
          owned,
          total,
          missing: total - owned,
          progress: owned / total,
        });
      }
    }
    rows.sort((a, b) => b.progress - a.progress);
    return rows.slice(0, 5);
  }, [library]);

  const userName = googleUser?.name ?? t("profile.reader");
  const initial = userName?.[0]?.toUpperCase() ?? "U";
  const avatarUrl = !avatarFailed ? (settings?.avatarUrl ?? null) : null;

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
            {/* Avatar — click to open picker. Wrapped in a relative
                container so the welcome-tour spotlight (caption + ring)
                can be positioned absolutely against the same anchor. */}
            <div className="relative shrink-0">
              <button
                ref={avatarRef}
                onClick={() => {
                  setTourSpotlight(false);
                  setPickerOpen(true);
                }}
                aria-label={t("avatar.changeAria")}
                className={`group relative h-20 w-20 shrink-0 overflow-hidden rounded-full ring-1 ring-border transition-all hover:ring-hanko hover:shadow-[0_0_32px_rgba(220,38,38,0.35)] md:h-24 md:w-24 ${
                  tourSpotlight ? "tour-pulse ring-hanko" : ""
                } ${
                  avatarUrl
                    ? "bg-ink-2"
                    : "bg-gradient-to-br from-gold to-gold-muted"
                }`}
              >
              {avatarUrl ? (
                <img referrerPolicy="no-referrer"
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

              {/* Welcome-tour spotlight caption — anchors to the avatar
                  via the relative wrapper above. The kanji + arrow point
                  at the button so a brand-new user immediately knows
                  "this is the thing to click". Auto-dismisses after 7s
                  or on click of the avatar; the parent state flip turns
                  the entire span off, so once the user has acted it
                  doesn't linger. */}
              {tourSpotlight && (
                <div
                  role="status"
                  aria-live="polite"
                  className="pointer-events-none absolute left-full top-1/2 z-10 ml-4 -translate-y-1/2 animate-fade-in"
                >
                  <div className="relative whitespace-nowrap rounded-full border border-hanko/60 bg-ink-0/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-hanko-bright shadow-[0_4px_20px_rgba(220,38,38,0.35)] backdrop-blur">
                    <span
                      className="font-jp text-sm tracking-normal"
                      aria-hidden="true"
                    >
                      印
                    </span>
                    <span className="ml-2 inline-block animate-tour-bob">
                      ← {t("tour.spotlightAvatar")}
                    </span>
                  </div>
                </div>
              )}
            </div>

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

        {/* Stat-card colour grammar (matches Dashboard):
              · count        → washi    (series, volumes owned/total)
              · achievement  → gold     (€ invested — lifetime spend)
              · rate         → hanko    (completion %) */}
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
            accent="hanko"
            loading={loading}
          />
        </section>

        <section
          className="mb-8 grid gap-6 animate-fade-up md:grid-cols-2"
          style={{ animationDelay: "200ms" }}
        >
          {/* "Closest to completion" — replaces the previous global donut.
              Five rows × (cover + title + bar + remaining), each one a
              tappable shortcut to that series' edit page. Density-first:
              the donut showed a single percentage already in the stat strip
              above; this card shows five concrete next targets. */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                  {t("profile.closestLabel")}
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold text-washi">
                  {t("profile.closestHeading")}
                </h2>
              </div>
              {!loading && inProgress.length > 0 && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                  {t("profile.closestCount", { n: inProgress.length })}
                </span>
              )}
            </div>

            <div className="mt-4 h-64">
              {loading ? (
                <ul className="flex h-full flex-col gap-3">
                  {[...Array(5)].map((_, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-ink-2/30 px-2 py-2"
                    >
                      <Skeleton className="h-10 w-7 rounded-sm" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-1 w-full" />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : inProgress.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <span
                    className="font-display text-4xl italic text-hanko/30"
                    aria-hidden="true"
                  >
                    完
                  </span>
                  <p className="text-sm text-washi-muted">
                    {t("profile.closestEmpty")}
                  </p>
                </div>
              ) : (
                <ul className="flex h-full flex-col gap-2">
                  {inProgress.map((row, i) => {
                    const pct = Math.round(row.progress * 100);
                    return (
                      <li key={row.mal_id ?? i}>
                        <button
                          type="button"
                          onClick={() =>
                            navigate("/mangapage", {
                              state: {
                                manga: row.manga,
                                adult_content_level,
                              },
                            })
                          }
                          className="group flex w-full items-center gap-3 rounded-lg border border-border/60 bg-ink-2/30 px-2 py-1.5 text-left transition hover:border-hanko/50 hover:bg-ink-2/60"
                        >
                          <span className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded-sm border border-border bg-ink-2 shadow-sm">
                            <CoverImage
                              src={row.manga.image_url_jpg}
                              alt=""
                              imgClassName="h-full w-full object-cover"
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="truncate font-display text-sm font-semibold text-washi group-hover:text-hanko-bright">
                                {row.title}
                              </p>
                              <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-washi-dim">
                                <span className="text-washi">
                                  {row.owned}
                                </span>
                                {" / "}
                                {row.total}
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <div
                                className="h-1 flex-1 overflow-hidden rounded-full bg-washi/10"
                                role="progressbar"
                                aria-valuenow={pct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={t("profile.closestAria", {
                                  title: row.title,
                                  pct,
                                })}
                              >
                                <div
                                  className="h-full bg-gradient-to-r from-hanko to-hanko-bright transition-all duration-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-hanko-bright">
                                {t("profile.closestRemaining", {
                                  n: row.missing,
                                })}
                              </span>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
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

        <section
          className="animate-fade-up"
          style={{ animationDelay: "350ms" }}
        >
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

        {/* ─── Analytics deep-dive ─────────────────────────────── */}
        <section
          className="mt-8 animate-fade-up"
          style={{ animationDelay: "400ms" }}
        >
          <SpendingChart data={analytics.monthly.spending} loading={loading} />
        </section>

        {/* 読破 · Reading cadence — sibling of SpendingChart, moegi-tinted,
            rolled-up quick-stats + monthly bar chart of read_at timestamps. */}
        <section
          className="mt-6 animate-fade-up"
          style={{ animationDelay: "430ms" }}
        >
          <ReadingChart reading={analytics.reading} loading={loading} />
        </section>

        <section
          className="mt-6 animate-fade-up"
          style={{ animationDelay: "470ms" }}
        >
          <CompositionPies
            stores={analytics.composition.stores}
            genres={analytics.composition.genres}
            loading={loading}
          />
        </section>

        <section
          className="mt-6 animate-fade-up"
          style={{ animationDelay: "500ms" }}
        >
          <InsightCards
            collector={analytics.collector}
            coffret={analytics.coffret}
            milestones={analytics.milestones}
            loading={loading}
          />
        </section>

        <section
          className="mt-6 animate-fade-up"
          style={{ animationDelay: "550ms" }}
        >
          <ActionableLists
            middleGaps={analytics.middleGaps}
            stale={analytics.stale}
            loading={loading}
            library={library}
          />
        </section>

        <section
          className="mt-8 animate-fade-up"
          style={{ animationDelay: "600ms" }}
        >
          <ActivityFeed limit={20} />
        </section>

        <section
          className="mt-8 animate-fade-up"
          style={{ animationDelay: "650ms" }}
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
      {hint && <p className="mt-1 text-[11px] text-washi-muted">{hint}</p>}
      <div className="pointer-events-none absolute -bottom-6 -right-6 h-16 w-16 rounded-full bg-hanko/10 blur-2xl opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
