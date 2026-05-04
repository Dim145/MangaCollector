import {
  forwardRef,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { consumeTourStep, peekTourStep, TOUR_STEPS } from "@/lib/tour.js";
import CoverImage from "./ui/CoverImage.jsx";
import DefaultBackground from "./DefaultBackground";
import Skeleton from "./ui/Skeleton.jsx";
import ActivityFeed from "./ActivityFeed.jsx";
import MalRecommendations from "./MalRecommendations.jsx";

// Modal — only needed on click, deferred so it doesn't bloat the profile chunk.
const AvatarPicker = lazy(() => import("./AvatarPicker.jsx"));
// 棚 · Snapshot modal — same lazy treatment as AvatarPicker. The
// canvas renderer + the modal chrome together weigh ~10 KB; keeping
// them out of the initial /profile chunk costs nothing and saves
// the bytes for users who never open the modal.
const ShelfSnapshotModal = lazy(() => import("./ShelfSnapshotModal.jsx"));
import SettingsContext from "@/SettingsContext.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useOnline } from "@/hooks/useOnline.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { useUserSettings } from "@/hooks/useSettings.js";
import { formatCurrency } from "@/utils/price.js";
import { useOwnPublicSlug } from "@/hooks/usePublicProfile.js";
import { useT } from "@/i18n/index.jsx";
import {
  pickBracket,
  useDailyByline,
  useDailyInsight,
} from "@/lib/dailyTexts.js";

export default function ProfilePage({ googleUser }) {
  const { currency: currencySetting, adult_content_level } =
    useContext(SettingsContext);
  // 連 · Connectivity gate for the Friends chip in the analytics
  // cluster. The /friends page is entirely network-bound (cross-
  // user activity feed + follow-list both require the server),
  // so the chip can't lead anywhere useful when offline.
  const online = useOnline();
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

  // 個 · Identity meta — public slug lets the hero render `@slug`
  // under the display name, mirroring how friends see this user.
  // The deep-dive numbers + chart wall used to live here too;
  // they've moved to /stats so the page stays a true profile.
  const { data: slugData } = useOwnPublicSlug();

  const {
    totalSeries,
    totalVolumes,
    totalVolumesOwned,
    totalCost,
    completionRate,
    memberSinceDays,
  } = useMemo(() => {
    const totalSeries = library.length;
    const totalVolumes = volumes.length;

    let owned = 0;
    let cost = 0;
    let firstAddedTs = Infinity;
    for (const series of library) {
      const ts = series.created_on
        ? new Date(series.created_on).getTime()
        : NaN;
      if (Number.isFinite(ts) && ts < firstAddedTs) firstAddedTs = ts;
    }

    for (const vol of volumes) {
      if (vol.owned) {
        owned += 1;
        cost += Number(vol.price) || 0;
      }
    }

    const completion =
      totalVolumes > 0 ? Number(((owned / totalVolumes) * 100).toFixed(1)) : 0;

    const memberSinceDays = Number.isFinite(firstAddedTs)
      ? Math.max(0, Math.floor((Date.now() - firstAddedTs) / (1000 * 60 * 60 * 24)))
      : null;

    return {
      totalSeries,
      totalVolumes,
      totalVolumesOwned: owned,
      totalCost: cost,
      completionRate: completion,
      memberSinceDays,
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
  const publicSlug = (slugData?.public_slug ?? slugData?.slug ?? "").trim();
  // 日替り · Daily-rotating prose for the byline + insight banner.
  // The byline pool is uniform across users; the insight pool is
  // bracketed by completion ratio so the prose always matches the
  // shape of the user's archive ("you're at the start" vs "the
  // archive is complete"). Both rotate every UTC midnight via a
  // deterministic seed — see `lib/dailyTexts.js`.
  const dailyByline = useDailyByline();
  const insightBracket = pickBracket({ totalVolumesOwned, completionRate });
  const dailyInsight = useDailyInsight(insightBracket);
  // 暦 · Member-since formatting. Cap at "X years" past 365 d, drop
  // to "Y months" past 30 d, "N days" otherwise. Localised via the
  // existing i18n keys.
  const memberSinceLabel = useMemo(() => {
    if (memberSinceDays == null) return null;
    if (memberSinceDays >= 365) {
      const years = Math.floor(memberSinceDays / 365);
      return t("profile.memberYears", { n: years });
    }
    if (memberSinceDays >= 30) {
      const months = Math.floor(memberSinceDays / 30);
      return t("profile.memberMonths", { n: months });
    }
    return t("profile.memberDays", { n: memberSinceDays });
  }, [memberSinceDays, t]);

  return (
    <DefaultBackground>
      <div className="mx-auto max-w-6xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* 名刺 · Calling-card hero — the page's identity panel.
            Replaces the previous mixed identity-+-stat hero now
            that /stats owns the deep-dive numbers. Avatar in a
            hanko-bordered medallion, name in big italic display,
            slug + tenure stamped underneath like the "what to
            call them by" line on a meishi. */}
        <header className="relative mb-10 animate-fade-up overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-ink-1/70 via-ink-1/55 to-hanko/[0.08] px-5 py-6 backdrop-blur-sm md:px-8 md:py-8">
          {/* 個 · Massive watermark — same vocabulary as the StatsHero
              but using the "individual / person" kanji to mark this
              page as the personal one. Pointer-events disabled so
              cards above it stay clickable. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-4 -top-4 select-none font-jp text-[clamp(7rem,17vw,13rem)] font-bold leading-none text-hanko/[0.07] md:-right-6"
            style={{ transform: "rotate(-6deg)" }}
          >
            個
          </span>

          <div className="relative flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
              {t("profile.profile")} · 名刺
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-hanko/30 via-border to-transparent" />
          </div>

          <div className="relative mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
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
              <h1
                data-ink-trail="true"
                className="font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-5xl"
              >
                {t("profile.helloName")}{" "}
                <span className="text-hanko-gradient font-semibold not-italic">
                  {userName}
                </span>
              </h1>
              {/* Identity meta-line — slug if set + tenure. Both
                  pieces sit on the same row so the visual
                  vocabulary reads like a printed meishi: "@handle
                  · membre depuis 2 ans". Either piece can be
                  absent without breaking the layout (the · is
                  conditionally rendered). */}
              {(publicSlug || memberSinceLabel) && (
                <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.18em] text-washi-muted">
                  {publicSlug ? (
                    <Link
                      to={`/u/${publicSlug}`}
                      className="text-hanko-bright transition hover:text-hanko"
                    >
                      @{publicSlug}
                    </Link>
                  ) : null}
                  {publicSlug && memberSinceLabel ? (
                    <span aria-hidden="true" className="text-washi-dim">
                      ·
                    </span>
                  ) : null}
                  {memberSinceLabel ? (
                    <span>
                      <span
                        aria-hidden="true"
                        className="font-jp text-[12px] font-bold not-italic text-gold"
                      >
                        始
                      </span>{" "}
                      {memberSinceLabel}
                    </span>
                  ) : null}
                </p>
              )}
              <p className="mt-2 text-sm italic text-washi-muted">
                {dailyByline}
              </p>
              {/* 五 · Five identity-portal chips — ONE accent each,
                  picked semantically rather than for visual variety
                  alone. Walking the row left-to-right reads as a
                  little colour grammar:
                    収 gold     — annual harvest, gilt-edged ledger
                    棚 hanko    — the seal you press to share
                    山 sakura   — the gentle pile of unread tomes
                    印 ai       — indigo archive of past snapshots
                    友 moegi    — friendship, growth, social
                  The shared `ProfileChip` (defined at the bottom
                  of this file) owns the markup; the per-chip line
                  here is just data + handler wiring. */}
              <div className="mt-3 flex flex-wrap gap-2">
                <ProfileChip
                  to="/year-in-review"
                  accent="gold"
                  kanji="収"
                  label={t("profile.yearReviewCta", {
                    year: new Date().getFullYear(),
                  })}
                />
                <ProfileChip
                  ref={snapshotRef}
                  accent="hanko"
                  kanji="棚"
                  label={t("profile.snapshotCta")}
                  spotlight={snapshotSpotlight}
                  spotlightHint={t("tour.fSnapshotCta")}
                  disabled={loading || (library?.length ?? 0) === 0}
                  onClick={() => {
                    setSnapshotSpotlight(false);
                    setSnapshotOpen(true);
                  }}
                />
                <ProfileChip
                  to="/backlog"
                  accent="sakura"
                  kanji="山"
                  label={t("profile.backlogCta")}
                />
                <ProfileChip
                  to="/snapshots"
                  accent="ai"
                  kanji="印"
                  label={t("profile.snapshotsCta")}
                />
                {online ? (
                  <ProfileChip
                    to="/friends"
                    accent="moegi"
                    kanji="友"
                    label={t("profile.friendsCta")}
                  />
                ) : (
                  <ProfileChip
                    accent="moegi"
                    kanji="圏"
                    label={t("profile.friendsCta")}
                    disabled
                    title={t("profile.friendsOfflineHint")}
                  />
                )}
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

        {/* 帳 · Bridge to the deep-dive ledger. Sits between the
            hero stats and the chart wall — the user already has
            the at-a-glance numbers above; this CTA tells them
            where to go for the rest. */}
        <Link
          to="/stats"
          className="group relative mb-10 flex items-center gap-4 overflow-hidden rounded-2xl border border-border/70 bg-ink-1/55 px-5 py-4 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-hanko/55 hover:shadow-[0_22px_36px_-22px_rgba(176,30,42,0.4)] md:px-6"
        >
          <span
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-hanko/55 bg-hanko/15 font-jp text-2xl font-bold leading-none text-hanko shadow-inner md:h-14 md:w-14"
            style={{ transform: "rotate(-4deg)" }}
          >
            帳
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-hanko">
              {t("stats.profileCtaHint")}
            </p>
            <p className="mt-1 font-display text-lg italic text-washi md:text-xl">
              {t("stats.profileCta")}
            </p>
          </div>
          <span
            aria-hidden="true"
            className="font-mono text-[14px] text-washi-muted transition-transform group-hover:translate-x-0.5 group-hover:text-hanko"
          >
            →
          </span>
        </Link>

        <section
          className="mb-8 animate-fade-up"
          style={{ animationDelay: "200ms" }}
        >
          {/* 完 · Closest to completion — five tappable rows
              shortcutting straight to each series' detail page.
              Used to share the row with `<MostValuedChart>`; the
              chart moved to /stats and this widget gets the full
              column to itself. */}
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

            {/* No fixed height — the widget used to share a row
                with `<MostValuedChart>` and the `h-64` cap was
                tuned to match that chart's intrinsic height. With
                the chart now living on /stats, the cap was just
                clipping the 5th row. Letting the flex column flow
                naturally fits all five entries plus the empty
                state without a scrollbar. */}
            <div className="mt-4">
              {loading ? (
                <ul className="flex flex-col gap-3">
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
                // py-12 gives the empty state breathing room now
                // that the parent no longer enforces h-64.
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
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
                <ul className="flex flex-col gap-2">
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

        </section>

        {/* 報 · One-line ceremonial line that frames the user's
            current standing — sibling of the rotating poster
            messages on the homepage hero. Empty / mid / late-game
            phrasing keeps the page from feeling silent the day
            you join, and warm the day you finish your hundredth. */}
        <section
          className="mb-8 animate-fade-up"
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
              {dailyInsight}
            </h3>
          </div>
        </section>

        {/* 連 · Recent activity — the personal correspondence
            stream. Capped at 20 to keep the page profile-shaped
            (the dedicated /year-in-review opens for a longer
            retrospective). */}
        <section
          className="mb-8 animate-fade-up"
          style={{ animationDelay: "400ms" }}
        >
          <ActivityFeed limit={20} />
        </section>

        <section
          className="animate-fade-up"
          style={{ animationDelay: "450ms" }}
        >
          <MalRecommendations />
        </section>
      </div>
    </DefaultBackground>
  );
}

/**
 * 札 · ProfileChip — the meishi-row identity portals.
 *
 * One pill, five accents — colour grammar tied to the chip's
 * conceptual domain rather than picked at random. The accent
 * threads through three CSS custom properties so a single
 * Tailwind className can express border / fill / glyph colour
 * without duplicating utility chains per accent.
 *
 * Props:
 *   - accent       "gold" | "hanko" | "sakura" | "ai" | "moegi"
 *   - kanji        single-char glyph rendered as the accent prefix
 *   - label        body text (uppercase mono)
 *   - to           if set → renders as <Link>, otherwise <button>
 *   - onClick      handler when not a Link
 *   - disabled     dims the pill + blocks pointer events
 *   - title        forwarded to the DOM element (useful for
 *                  the offline-state tooltip on the friends chip)
 *   - spotlight    true while the welcome tour highlights the
 *                  chip — adds the same hanko-pulse used on the
 *                  avatar so the two follow targets feel like
 *                  siblings
 *   - spotlightHint label drawn above the chip during spotlight
 *
 * Forwarded ref: lands on the rendered `<a>` / `<button>` so
 * the tour effect can `scrollIntoView` the chip when its step
 * fires before the chip has mounted.
 */
const PROFILE_CHIP_ACCENTS = {
  gold: { bg: "var(--gold)", glow: "rgba(212,175,55,0.45)" },
  hanko: { bg: "var(--hanko)", glow: "rgba(176,30,42,0.45)" },
  sakura: { bg: "var(--sakura)", glow: "rgba(220,160,170,0.45)" },
  ai: { bg: "var(--ai)", glow: "rgba(60,90,180,0.45)" },
  moegi: { bg: "var(--moegi)", glow: "rgba(120,180,90,0.45)" },
};

const ProfileChip = forwardRef(function ProfileChip(
  {
    accent = "hanko",
    kanji,
    label,
    to,
    onClick,
    disabled = false,
    title,
    spotlight = false,
    spotlightHint,
  },
  ref,
) {
  const { bg, glow } = PROFILE_CHIP_ACCENTS[accent] ?? PROFILE_CHIP_ACCENTS.hanko;
  const styleVars = {
    "--chip-accent": bg,
    "--chip-glow": glow,
  };

  // The class chain reads "border 40 % opacity + bg 6 % + text
  // accent" at rest, then "border 80 % + bg 12 % + lift 0.5 px
  // + accent-tinted shadow" on hover — same vocabulary across
  // all five accents thanks to `--chip-accent`.
  const baseClass =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--chip-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-ink-1";
  const idleClass =
    "border-[color:var(--chip-accent)]/40 bg-[color:var(--chip-accent)]/[0.06] text-[color:var(--chip-accent)] hover:-translate-y-0.5 hover:border-[color:var(--chip-accent)]/80 hover:bg-[color:var(--chip-accent)]/[0.12] hover:shadow-[0_8px_22px_-10px_var(--chip-glow)]";
  const disabledClass =
    "border-[color:var(--chip-accent)]/25 bg-[color:var(--chip-accent)]/[0.04] text-[color:var(--chip-accent)]/60 opacity-60 cursor-not-allowed";
  const className = `${baseClass} ${disabled ? disabledClass : idleClass} ${
    spotlight ? "tour-pulse ring-[color:var(--chip-accent)]" : ""
  }`;

  const inner = (
    <>
      <span
        aria-hidden="true"
        className="font-jp text-sm font-bold leading-none not-italic"
      >
        {kanji}
      </span>
      {label}
      <span
        aria-hidden="true"
        className="-mr-0.5 transition-transform group-hover:translate-x-0.5"
      >
        →
      </span>
    </>
  );

  // Wrapper element: <Link> for routed chips, <button> for
  // imperative ones (snapshot modal trigger), <span> for the
  // offline-disabled friends placeholder.
  let chip;
  if (disabled && !to) {
    chip = (
      <span
        ref={ref}
        role="link"
        aria-disabled="true"
        title={title}
        aria-label={title}
        className={className}
        style={styleVars}
      >
        {inner}
      </span>
    );
  } else if (to) {
    chip = (
      <Link
        ref={ref}
        to={to}
        className={className}
        style={styleVars}
        title={title}
      >
        {inner}
      </Link>
    );
  } else {
    chip = (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={className}
        style={styleVars}
        title={title}
      >
        {inner}
      </button>
    );
  }

  // Spotlight requires a positioning anchor; wrap conditionally
  // so non-spotlight chips don't pay the extra wrapper.
  if (!spotlight) return chip;
  return (
    <span className="relative">
      {chip}
      {spotlightHint ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[color:var(--chip-accent)]/55 bg-ink-1/95 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--chip-accent)] shadow-[0_4px_14px_var(--chip-glow)] animate-fade-up"
          style={styleVars}
        >
          {spotlightHint}
        </span>
      ) : null}
    </span>
  );
});

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

