import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { consumeTourStep, peekTourStep, TOUR_STEPS } from "@/lib/tour.js";
import CoverImage from "./ui/CoverImage.jsx";
import DefaultBackground from "./DefaultBackground";
import Skeleton from "./ui/Skeleton.jsx";
import ActivityFeed from "./ActivityFeed.jsx";
import MalRecommendations from "./MalRecommendations.jsx";
import InsightCards from "./analytics/InsightCards.jsx";
import ActionableLists from "./analytics/ActionableLists.jsx";

// 金 · Recharts is heavy (380 KB / 110 KB gzipped). Every component
// in this app that touches it lives behind a `lazy()` boundary so
// /profile lands instantly with stat cards + the closest-to-completion
// list, then streams the chart bundle alongside the first chart's
// own skeleton. The Suspense fallback below mirrors each card's
// idle-loading visuals so the layout doesn't jank when the chunk
// finishes downloading.
const MostValuedChart = lazy(() => import("./analytics/MostValuedChart.jsx"));
const SpendingChart = lazy(() => import("./analytics/SpendingChart.jsx"));
const ReadingChart = lazy(() => import("./analytics/ReadingChart.jsx"));
const CompositionPies = lazy(() => import("./analytics/CompositionPies.jsx"));
// Modal — only needed on click, deferred so it doesn't bloat the profile chunk.
const AvatarPicker = lazy(() => import("./AvatarPicker.jsx"));
// 棚 · Snapshot modal — same lazy treatment as AvatarPicker. The
// canvas renderer + the modal chrome together weigh ~10 KB; keeping
// them out of the initial /profile chunk costs nothing and saves
// the bytes for users who never open the modal.
const ShelfSnapshotModal = lazy(() => import("./ShelfSnapshotModal.jsx"));
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
  const [snapshotOpen, setSnapshotOpen] = useState(false);
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
  const snapshotRef = useRef(null);
  const [tourSpotlight, setTourSpotlight] = useState(false);
  const [snapshotSpotlight, setSnapshotSpotlight] = useState(false);
  // 探 · Peek-then-consume so the AVATAR tour step survives a delayed
  // ref binding (the avatar button mounts after the user query
  // resolves). The previous code consumed eagerly at mount, so a
  // first-load race could leave the user looking at a no-op page —
  // their tour step gone, no spotlight, no recovery path.
  useEffect(() => {
    if (peekTourStep() !== TOUR_STEPS.AVATAR) return;
    if (!avatarRef.current) return; // wait for the ref to bind
    // Now that the ref is real, atomically consume + animate.
    const consumed = consumeTourStep();
    if (consumed !== TOUR_STEPS.AVATAR) return;
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
    // The ref's `.current` becomes truthy on the render that mounts
    // the avatar button; we want this effect to re-run on that render
    // until it succeeds. `googleUser` is the typical gate for that
    // mount, so depending on it gives us the right re-fire cadence
    // without polling. Once consumed, the peek returns null and the
    // effect early-returns on subsequent re-renders.
  }, [googleUser]);

  // 棚 · Welcome-tour spotlight on the shelf-snapshot button.
  // Same peek-then-consume pattern as the avatar above — the button
  // mounts after the library query resolves, so we wait for the ref
  // before atomically consuming the step. We also gate on
  // `library?.length` because the button is `disabled` on an empty
  // library; spotlighting a disabled control is worse than skipping
  // the spotlight entirely (the user would think the click is broken).
  useEffect(() => {
    if (peekTourStep() !== TOUR_STEPS.SNAPSHOT) return;
    if (!snapshotRef.current) return;
    if ((library?.length ?? 0) === 0) return;
    const consumed = consumeTourStep();
    if (consumed !== TOUR_STEPS.SNAPSHOT) return;
    setSnapshotSpotlight(true);
    const raf = requestAnimationFrame(() => {
      snapshotRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
    const timer = setTimeout(() => setSnapshotSpotlight(false), 7000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [googleUser, library?.length]);

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
              {/* 収 · Year-in-review entry point — sits below the byline
                  as a discreet outline chip. Visible year-round (the
                  poster gracefully degrades to its empty-state surface
                  when there's not enough story for the current year),
                  with the harvest kanji acting as the conceptual
                  signpost. */}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to="/year-in-review"
                  className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-gold transition hover:border-gold/70 hover:bg-gold/10 hover:text-gold-muted"
                >
                  <span
                    aria-hidden="true"
                    className="font-jp text-sm font-bold leading-none not-italic"
                  >
                    収
                  </span>
                  {t("profile.yearReviewCta", { year: new Date().getFullYear() })}
                  <span aria-hidden="true">→</span>
                </Link>
                {/* 棚 · Shelf snapshot — opens a modal that renders the
                    library as a 4:5 PNG ready to share on social. The
                    button keeps the same outline-chip vocabulary as the
                    Year-in-Review entry point so they read as a peer
                    pair of "stats / sharing" hooks rather than competing
                    primary CTAs. Disabled until the library has data —
                    a snapshot of an empty shelf reads as broken.

                    `tour-pulse` (defined in styles/index.css alongside the
                    avatar spotlight) adds the hanko ring pulse when the
                    welcome tour just landed here — same animation
                    language as the avatar so the two follow targets
                    feel like siblings. */}
                <div className="relative">
                  <button
                    ref={snapshotRef}
                    type="button"
                    onClick={() => {
                      setSnapshotSpotlight(false);
                      setSnapshotOpen(true);
                    }}
                    disabled={loading || (library?.length ?? 0) === 0}
                    className={`inline-flex items-center gap-2 rounded-full border border-hanko/40 bg-hanko/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-hanko-bright transition hover:border-hanko/70 hover:bg-hanko/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-hanko/5 disabled:hover:border-hanko/40 ${
                      snapshotSpotlight ? "tour-pulse ring-hanko" : ""
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="font-jp text-sm font-bold leading-none not-italic"
                    >
                      棚
                    </span>
                    {t("profile.snapshotCta")}
                    <span aria-hidden="true">→</span>
                  </button>
                  {snapshotSpotlight && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-hanko/50 bg-ink-1/95 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-hanko-bright shadow-[0_4px_14px_var(--hanko-glow)] animate-fade-up"
                    >
                      {t("tour.fSnapshotCta")}
                    </span>
                  )}
                </div>
                {/* 山積 · Backlog audit — peer chip alongside Year-in-
                    Review and Shelf-snapshot. Pile lives conceptually
                    next to the analytics here rather than as a
                    standalone menu entry; surfacing it as a third chip
                    keeps the trio of "look back / share / what's still
                    pending" together. Hanko outline (vs gold/sakura)
                    so the eye distinguishes the three at a glance. */}
                <Link
                  to="/backlog"
                  className="inline-flex items-center gap-2 rounded-full border border-hanko/40 bg-hanko/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-hanko-bright transition hover:border-hanko/70 hover:bg-hanko/10"
                >
                  <span
                    aria-hidden="true"
                    className="font-jp text-sm font-bold leading-none not-italic"
                  >
                    山
                  </span>
                  {t("profile.backlogCta")}
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
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

        {snapshotOpen && (
          <Suspense fallback={null}>
            <ShelfSnapshotModal
              open={snapshotOpen}
              onClose={() => setSnapshotOpen(false)}
              library={library ?? []}
              userName={settings?.username || googleUser?.name || ""}
              // New labelled-stats shape — each segment carries its
              // own eyebrow so the snapshot footer reads stand-alone
              // ("56 %" without a label was ambiguous to anyone who
              // didn't already know the app).
              stats={[
                {
                  value: `${totalVolumesOwned} 巻`,
                  label: t("snapshot.statLabelVolumes"),
                },
                {
                  value: `${totalSeries}`,
                  label: t("snapshot.statLabelSeries"),
                },
                {
                  value: `${completionRate.toFixed(0)} %`,
                  label: t("snapshot.statLabelComplete"),
                  accent: true,
                },
              ]}
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
                              viewTransition: true,
                            })
                          }
                          className="group flex w-full items-center gap-3 rounded-lg border border-border/60 bg-ink-2/30 px-2 py-1.5 text-left transition hover:border-hanko/50 hover:bg-ink-2/60"
                        >
                          <span className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded-sm border border-border bg-ink-2 shadow-sm">
                            <CoverImage
                              src={row.manga.image_url_jpg}
                              alt=""
                              paletteSeed={row.manga.mal_id}
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

          <Suspense fallback={<ChartSkeletonCard kind="bars" />}>
            <MostValuedChart
              data={seriesByCost}
              loading={loading}
              currencySetting={currencySetting}
            />
          </Suspense>
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
          <Suspense fallback={<ChartSkeletonCard kind="bars" />}>
            <SpendingChart data={analytics.monthly.spending} loading={loading} />
          </Suspense>
        </section>

        {/* 読破 · Reading cadence — sibling of SpendingChart, moegi-tinted,
            rolled-up quick-stats + monthly bar chart of read_at timestamps. */}
        <section
          className="mt-6 animate-fade-up"
          style={{ animationDelay: "430ms" }}
        >
          <Suspense fallback={<ChartSkeletonCard kind="bars" />}>
            <ReadingChart reading={analytics.reading} loading={loading} />
          </Suspense>
        </section>

        <section
          className="mt-6 animate-fade-up"
          style={{ animationDelay: "470ms" }}
        >
          <Suspense fallback={<ChartSkeletonCard kind="pie" />}>
            <CompositionPies
              stores={analytics.composition.stores}
              genres={analytics.composition.genres}
              loading={loading}
            />
          </Suspense>
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

/**
 * 金 · Suspense fallback for the lazy-loaded chart cards.
 *
 * Mirrors the inner skeleton each chart shows during its own
 * `loading` branch, so the layout stays put when the recharts
 * chunk arrives — no jank, no card flicker. `kind` switches
 * between bar-chart and pie-chart skeletons; both occupy the same
 * 16rem card height the live components do.
 */
function ChartSkeletonCard({ kind }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="mt-4 h-64">
        {kind === "pie" ? (
          <div className="flex h-full items-center justify-center">
            <Skeleton.Circle size={180} thickness={28} />
          </div>
        ) : (
          <Skeleton.Bars count={6} maxHeight={230} />
        )}
      </div>
    </div>
  );
}
