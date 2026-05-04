import { lazy, Suspense, useContext, useMemo } from "react";
import SettingsContext from "@/SettingsContext.js";
import DefaultBackground from "./DefaultBackground.jsx";
import StatsHero from "./analytics/StatsHero.jsx";
import StatsNavRail from "./analytics/StatsNavRail.jsx";
import SectionFolio from "./analytics/SectionFolio.jsx";
import AuthorsRail from "./analytics/AuthorsRail.jsx";
import PublishersRail from "./analytics/PublishersRail.jsx";
import ReadingPaceTriad from "./analytics/ReadingPaceTriad.jsx";
import TreasureGrid from "./analytics/TreasureGrid.jsx";
import TimeStudy from "./analytics/TimeStudy.jsx";
import RecentSealCard from "./analytics/RecentSealCard.jsx";
import FriendsInsights from "./analytics/FriendsInsights.jsx";
import InsightCards from "./analytics/InsightCards.jsx";
import ActionableLists from "./analytics/ActionableLists.jsx";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { useUserSettings } from "@/hooks/useSettings.js";
import { useProfileAnalytics } from "@/hooks/useProfileAnalytics.js";
import { useExtendedAnalytics } from "@/hooks/useExtendedAnalytics.js";
import { useFriendsOverlap } from "@/hooks/useFriendsOverlap.js";
import { useSeals } from "@/hooks/useSeals.js";
import { useOnline } from "@/hooks/useOnline.js";
import { useT, useLang } from "@/i18n/index.jsx";

// 金 · Recharts payloads stay lazy on the deep-dive page too —
// the user that follows the link from /profile is data-curious
// but that doesn't mean we should ship 400 KB synchronously.
const MostValuedChart = lazy(() => import("./analytics/MostValuedChart.jsx"));
const SpendingChart = lazy(() => import("./analytics/SpendingChart.jsx"));
const ReadingChart = lazy(() => import("./analytics/ReadingChart.jsx"));
const CompositionPies = lazy(() => import("./analytics/CompositionPies.jsx"));

/**
 * 帳 · StatsPage — the deep-dive ledger for the user's
 * collection. Mounted at `/stats`, reachable from /profile via
 * the "Voir toutes les statistiques" CTA.
 *
 * Layout strategy: a sticky vertical kanji rail on lg+ screens
 * with the section folios stacked alongside it; a horizontal
 * chip row replaces the rail on mobile. Each folio has its own
 * accent color (driven through `--folio-accent`) so the eye can
 * tell sections apart while scrolling without needing colour-
 * named class chains in every component.
 */
export default function StatsPage() {
  const t = useT();
  const lang = useLang();
  const { currency: currencySetting } = useContext(SettingsContext) ?? {};
  // Settings can come either through the existing SettingsContext
  // (preferred, no extra fetch) or fall back to the cached row.
  const { data: settings } = useUserSettings();
  const currency = currencySetting ?? settings?.currency ?? "EUR";

  const online = useOnline();

  const { data: library, isInitialLoad: libLoading } = useLibrary();
  const { data: volumes, isInitialLoad: volLoading } = useAllVolumes();
  const baseLoading = libLoading || volLoading;

  const profileAnalytics = useProfileAnalytics();
  const extended = useExtendedAnalytics({ lang });
  const overlap = useFriendsOverlap({ enabled: online });
  const sealsRes = useSeals();

  // Stable reference for `useMemo` deps: `?.data?.earned ?? []`
  // returns a fresh empty array on every render when there's no
  // data, which would invalidate the hero totals each tick.
  const earnedSeals = useMemo(
    () => sealsRes?.data?.earned ?? [],
    [sealsRes?.data?.earned],
  );

  // Hero totals — kept aligned with the slim version shown on
  // the new ProfilePage. Three figures + a seal counter.
  const heroTotals = useMemo(() => {
    const lib = library ?? [];
    const vols = volumes ?? [];
    const ownedVols = vols.filter((v) => v.owned);
    const totalVolumes = vols.length;
    return {
      seriesCount: lib.length,
      ownedVolumeCount: ownedVols.length,
      completionPct:
        totalVolumes > 0
          ? Math.round((ownedVols.length / totalVolumes) * 100)
          : 0,
      sealsCount: earnedSeals.length,
    };
  }, [library, volumes, earnedSeals]);

  // 金 · Top-5 series by cumulative spend — the input shape
  // `MostValuedChart` actually expects (`{ title, fullTitle,
  // totalCost }`). The earlier wiring fed it `monthly.spending`,
  // which is a 12-month timeseries — wrong axis, empty bars,
  // empty card. Mirrors the computation in ProfilePage:
  //   sum prices grouped by series name → sort desc → take 5 →
  //   shorten the X-axis title so the chart's y-axis bars
  //   don't overlap with overflowing labels.
  const seriesByCost = useMemo(() => {
    const lib = library ?? [];
    const vols = volumes ?? [];
    const titleMap = new Map();
    for (const s of lib) titleMap.set(s.mal_id, s.name);
    const costMap = new Map();
    for (const v of vols) {
      if (!v.owned) continue;
      const price = Number(v.price) || 0;
      if (price <= 0) continue;
      const title = titleMap.get(v.mal_id) || "—";
      costMap.set(title, (costMap.get(title) ?? 0) + price);
    }
    return Array.from(costMap.entries())
      .map(([title, c]) => ({
        title: title.split(" ").slice(0, 2).join(" ").slice(0, 12),
        fullTitle: title,
        totalCost: Number(c.toFixed(2)),
      }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 5);
  }, [library, volumes]);

  // Section descriptors — stable reference so the IntersectionObserver
  // inside the nav doesn't re-attach on every render.
  const sections = useMemo(
    () => [
      {
        id: "stats-authors",
        kanji: "人",
        accent: "hanko",
        label: t("stats.nav.authors"),
      },
      {
        id: "stats-publishers",
        kanji: "版",
        accent: "gold",
        label: t("stats.nav.publishers"),
      },
      {
        id: "stats-reading",
        kanji: "読",
        accent: "moegi",
        label: t("stats.nav.reading"),
      },
      {
        id: "stats-treasure",
        kanji: "銭",
        accent: "sakura",
        label: t("stats.nav.treasure"),
      },
      {
        id: "stats-time",
        kanji: "暦",
        accent: "ai",
        label: t("stats.nav.time"),
      },
      {
        id: "stats-seals",
        kanji: "印",
        accent: "hanko",
        label: t("stats.nav.seals"),
      },
      {
        id: "stats-tomo",
        kanji: "友",
        accent: "washi",
        label: t("stats.nav.tomo"),
      },
    ],
    [t],
  );

  return (
    <DefaultBackground>
      <StatsHero t={t} totals={heroTotals} loading={baseLoading} />

      <div className="mx-auto max-w-6xl px-4 pb-nav pt-2 sm:px-6 md:pb-20">
        <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
          <StatsNavRail sections={sections} t={t} />

          <main className="min-w-0">
            {/* 人 Auteurs — top author + ranking */}
            <SectionFolio
              id="stats-authors"
              kanji="人"
              accent="hanko"
              eyebrow={t("stats.authors.eyebrow")}
              title={t("stats.authors.title")}
              subtitle={t("stats.authors.subtitle")}
            >
              <AuthorsRail
                authors={extended.authors}
                t={t}
                loading={extended.loading}
              />
            </SectionFolio>

            {/* 版 Éditeurs */}
            <SectionFolio
              id="stats-publishers"
              kanji="版"
              accent="gold"
              eyebrow={t("stats.publishers.eyebrow")}
              title={t("stats.publishers.title")}
              subtitle={t("stats.publishers.subtitle")}
            >
              <PublishersRail
                publishers={extended.publishers}
                t={t}
                loading={extended.loading}
              />
            </SectionFolio>

            {/* 読 Lecture — chart on top, then the new pace cards */}
            <SectionFolio
              id="stats-reading"
              kanji="読"
              accent="moegi"
              eyebrow={t("stats.reading.eyebrow")}
              title={t("stats.reading.title")}
              subtitle={t("stats.reading.subtitle")}
            >
              <div className="flex flex-col gap-6">
                <Suspense fallback={<ChartSkeleton />}>
                  <ReadingChart
                    reading={profileAnalytics.reading}
                    loading={profileAnalytics.loading}
                  />
                </Suspense>
                <ReadingPaceTriad
                  delay={extended.readingDelay}
                  dokuha={extended.dokuhaRatio}
                  t={t}
                  loading={extended.loading}
                />
              </div>
            </SectionFolio>

            {/* 銭 Trésor — value-focused cards + existing charts */}
            <SectionFolio
              id="stats-treasure"
              kanji="銭"
              accent="sakura"
              eyebrow={t("stats.treasure.eyebrow")}
              title={t("stats.treasure.title")}
              subtitle={t("stats.treasure.subtitle")}
            >
              <div className="flex flex-col gap-6">
                <TreasureGrid
                  topVolumePrices={extended.topVolumePrices}
                  basketEvolution={extended.basketEvolution}
                  currency={currency}
                  t={t}
                  loading={extended.loading}
                />
                <Suspense fallback={<ChartSkeleton />}>
                  <SpendingChart
                    data={profileAnalytics.monthly?.spending}
                    loading={profileAnalytics.loading}
                  />
                </Suspense>
                <Suspense fallback={<ChartSkeleton />}>
                  <MostValuedChart
                    data={seriesByCost}
                    loading={profileAnalytics.loading}
                    currencySetting={currency}
                  />
                </Suspense>
                <InsightCards
                  collector={profileAnalytics.collector}
                  coffret={profileAnalytics.coffret}
                  milestones={profileAnalytics.milestones}
                  loading={profileAnalytics.loading}
                />
              </div>
            </SectionFolio>

            {/* 暦 Temps — anniversary + best quarter + composition */}
            <SectionFolio
              id="stats-time"
              kanji="暦"
              accent="ai"
              eyebrow={t("stats.time.eyebrow")}
              title={t("stats.time.title")}
              subtitle={t("stats.time.subtitle")}
            >
              <div className="flex flex-col gap-6">
                <TimeStudy
                  bestQuarter={extended.bestQuarter}
                  anniversary={extended.anniversary}
                  t={t}
                  lang={lang}
                  loading={extended.loading}
                />
                <Suspense fallback={<ChartSkeleton />}>
                  <CompositionPies
                    stores={profileAnalytics.composition?.stores}
                    genres={profileAnalytics.composition?.genres}
                    loading={profileAnalytics.loading}
                  />
                </Suspense>
                <ActionableLists
                  middleGaps={profileAnalytics.middleGaps}
                  stale={profileAnalytics.stale}
                  loading={profileAnalytics.loading}
                />
              </div>
            </SectionFolio>

            {/* 印 Sceaux — last seal */}
            <SectionFolio
              id="stats-seals"
              kanji="印"
              accent="hanko"
              eyebrow={t("stats.seals.eyebrow")}
              title={t("stats.seals.title")}
              subtitle={t("stats.seals.subtitle")}
            >
              <RecentSealCard
                earned={earnedSeals}
                t={t}
                lang={lang}
                loading={sealsRes?.isLoading ?? false}
              />
            </SectionFolio>

            {/* 友 Tomo — social-graph overlap. Online-only by design. */}
            <SectionFolio
              id="stats-tomo"
              kanji="友"
              accent="washi"
              eyebrow={t("stats.tomo.eyebrow")}
              title={t("stats.tomo.title")}
              subtitle={t("stats.tomo.subtitle")}
            >
              {!online ? (
                <article className="rounded-2xl border border-dashed border-border/70 bg-ink-1/30 px-6 py-10 text-center">
                  <p className="font-jp text-3xl font-bold leading-none text-washi-muted">
                    圏
                  </p>
                  <p className="mt-3 font-display text-base italic text-washi-muted">
                    {t("stats.tomo.offline")}
                  </p>
                </article>
              ) : (
                <FriendsInsights
                  overlap={overlap.data}
                  t={t}
                  loading={overlap.isLoading}
                />
              )}
            </SectionFolio>
          </main>
        </div>
      </div>
    </DefaultBackground>
  );
}

function ChartSkeleton() {
  return (
    <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-ink-1/40" />
  );
}
