import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import DefaultBackground from "./DefaultBackground.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { useUpcomingCalendar } from "@/hooks/useUpcomingCalendar.js";
import { useOnline } from "@/hooks/useOnline.js";
import { useT } from "@/i18n/index.jsx";

// Lazy — only mounts the first time the user opens the modal.
const CalendarSubscribeModal = lazy(() =>
  import("./CalendarSubscribeModal.jsx"),
);

/**
 * 暦 · CalendarPage — the upcoming-volume timeline.
 *
 * Two views, one data source:
 *
 *   - **Agenda** (default on every viewport): a vertical scroll
 *     organised as a *kakemono*. Each month is a monumental italic
 *     header; each release is a horizontal "ema 絵馬" plaque hung
 *     along the scroll, tilted slightly to break the grid. A "today"
 *     marker glides as a hanko-red ink line across the column.
 *   - **Month grid** (≥ md): a 7-column grid with cards per cell,
 *     compact and scannable at-a-glance. Months are stacked
 *     vertically so navigation is just a scroll, not a "click ›".
 *
 * The aesthetic anchor is the kanji 来 (rai = "to come / next"),
 * stamped as a faint vertical-rl watermark down the page like a
 * scroll's signature seal — it reads as "the future side of the
 * archive" without ever stating the word "future".
 *
 * Click on a release card → navigates to the series' MangaPage,
 * passing the volume id in `state.openVolumeId` so the page can
 * scroll-spotlight + open the upcoming drawer in one shot.
 */
export default function CalendarPage() {
  const t = useT();
  const navigate = useNavigate();

  // ── Window state ────────────────────────────────────────────────
  // Default window: this month → +6 months. The user can extend to
  // 12 months from the picker.
  const [windowMonths, setWindowMonths] = useState(6);
  const today = useMemo(() => startOfDay(new Date()), []);
  const range = useMemo(() => {
    const from = formatYearMonth(today);
    const untilDate = addMonths(today, windowMonths);
    const until = formatYearMonth(untilDate);
    return { from, until };
  }, [today, windowMonths]);

  // ── Subscribe modal ─────────────────────────────────────────────
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  // ── View toggle ─────────────────────────────────────────────────
  // Agenda is the canonical view; Month grid is a denser power-user
  // option exposed on desktop only. Persisted in localStorage so the
  // choice carries between sessions.
  const [view, setView] = useState(() => {
    try {
      const stored = localStorage.getItem("mc:calendar-view");
      return stored === "month" ? "month" : "agenda";
    } catch {
      return "agenda";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mc:calendar-view", view);
    } catch {
      /* private mode — silent */
    }
  }, [view]);

  // ── Filter state ────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim().toLowerCase();

  // ── Data ────────────────────────────────────────────────────────
  const { releases, isLoading, isError, refetch, isFetching, source } =
    useUpcomingCalendar({ from: range.from, until: range.until });

  // 連 · Connectivity gate. Drives:
  //   • the subscribe-button enabled state (ICS-token endpoint
  //     requires a server round-trip — no offline analogue)
  //   • the optional "served from cache" hint above the toolbar
  //     when the live query failed but Dexie still has data
  const online = useOnline();

  const filteredReleases = useMemo(() => {
    if (!trimmedQuery) return releases;
    return releases.filter((r) =>
      r.manga_name.toLowerCase().includes(trimmedQuery),
    );
  }, [releases, trimmedQuery]);

  // ── Group by month for both views ───────────────────────────────
  const byMonth = useMemo(() => groupByMonth(filteredReleases), [filteredReleases]);

  // ── Stats for the header eyebrow ────────────────────────────────
  const totalCount = filteredReleases.length;
  const nextRelease = filteredReleases[0] ?? null;
  const daysToNext = nextRelease
    ? Math.max(0, daysBetween(today, new Date(nextRelease.release_date)))
    : null;

  // ── Render ──────────────────────────────────────────────────────
  return (
    <DefaultBackground>
      <div className="relative mx-auto max-w-6xl px-4 pb-nav pt-8 sm:px-6 md:pb-16 md:pt-12">
        {/* 巻 · Vertical 来 watermark, runs the full length of the
            page like the seal stamped down the side of a kakemono.
            text-vertical via writing-mode keeps the kanji upright in
            its column even as the page scrolls. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-12 hidden select-none font-jp text-[18rem] font-bold leading-none text-hanko/[0.045] md:block"
          style={{ writingMode: "vertical-rl", letterSpacing: "0.5rem" }}
        >
          来 月 暦
        </span>

        {/* ── Masthead ──────────────────────────────────────────── */}
        <header className="relative mb-10 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
              {t("calendar.eyebrow")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h1 className="mt-3 font-display text-5xl font-light italic leading-[0.92] tracking-tight text-washi md:text-6xl lg:text-7xl">
            {t("calendar.titleStart")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("calendar.titleAccent")}
            </span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-washi-muted md:text-base">
            {t("calendar.subtitle")}
          </p>

          {/* 統計 · Tiny stat strip — count + days to next release. */}
          <div className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-dim">
            <span>
              <span className="font-display text-2xl italic font-semibold not-italic text-washi">
                {totalCount}
              </span>{" "}
              {t("calendar.statCount")}
            </span>
            {daysToNext != null && (
              <span>
                <span className="font-display text-2xl italic font-semibold not-italic text-moegi">
                  J−{daysToNext}
                </span>{" "}
                {t("calendar.statNext")}
              </span>
            )}
            {byMonth.length > 0 && (
              <span>
                <span className="font-display text-2xl italic font-semibold not-italic text-washi">
                  {byMonth.length}
                </span>{" "}
                {t("calendar.statMonths")}
              </span>
            )}
          </div>
        </header>

        {/* 連 · Offline banner — surfaces ONLY when the live query
            has nothing AND Dexie still does. The user is reading
            stale data, which is fine for the calendar (a static
            view of upcoming releases that already happened to be
            captured) but worth flagging so a missing release isn't
            mistaken for a cancellation. Suppressed when online to
            stay quiet during the common case. */}
        {!online && source === "cache" && (
          <div
            className="mb-4 flex items-center gap-2 rounded-xl border border-moegi/40 bg-moegi/5 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-moegi animate-fade-up"
            role="status"
            aria-live="polite"
            style={{ animationDelay: "100ms" }}
          >
            <span aria-hidden="true" className="font-jp text-[12px] leading-none">
              圏
            </span>
            <span>{t("calendar.servedFromCache")}</span>
          </div>
        )}

        {/* ── Toolbar (filters + view toggle + horizon) ─────────── */}
        <Toolbar
          view={view}
          setView={setView}
          query={query}
          setQuery={setQuery}
          windowMonths={windowMonths}
          setWindowMonths={setWindowMonths}
          isFetching={isFetching}
          online={online}
          onRefetch={refetch}
          onSubscribe={() => setSubscribeOpen(true)}
          t={t}
        />

        {/* ── Loading / error / empty states ────────────────────── */}
        {isLoading ? (
          <CalendarSkeleton />
        ) : isError ? (
          <ErrorState onRetry={refetch} t={t} />
        ) : filteredReleases.length === 0 ? (
          <EmptyState hasQuery={Boolean(trimmedQuery)} t={t} />
        ) : view === "agenda" ? (
          <AgendaView
            byMonth={byMonth}
            today={today}
            navigate={navigate}
            t={t}
          />
        ) : (
          <MonthGridView
            byMonth={byMonth}
            today={today}
            navigate={navigate}
            t={t}
          />
        )}

        {/* 暦 · Subscribe modal — mounted lazily on first open, kept
            in the tree afterwards so reopening doesn't re-fetch the
            ICS URL. The fetch inside the modal is itself idempotent
            (server returns the existing token), but skipping the
            round-trip on second open is still nicer perceptually. */}
        {subscribeOpen && (
          <Suspense fallback={null}>
            <CalendarSubscribeModal
              open={subscribeOpen}
              onClose={() => setSubscribeOpen(false)}
            />
          </Suspense>
        )}
      </div>
    </DefaultBackground>
  );
}

// ─────────────────────────────────────────────────────────────────
// Toolbar
// ─────────────────────────────────────────────────────────────────

function Toolbar({
  view,
  setView,
  query,
  setQuery,
  windowMonths,
  setWindowMonths,
  isFetching,
  online = true,
  onRefetch,
  onSubscribe,
  t,
}) {
  return (
    <div
      className="mb-8 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-ink-1/40 p-3 backdrop-blur-sm animate-fade-up"
      style={{ animationDelay: "120ms" }}
    >
      {/* Search */}
      <label className="group relative flex-1 min-w-[14rem]">
        <span className="sr-only">{t("calendar.searchAria")}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-washi-dim transition-colors group-focus-within:text-hanko"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="20" y1="20" x2="16.5" y2="16.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("calendar.searchPlaceholder")}
          className="w-full rounded-full border border-border bg-ink-0/40 py-2 pl-9 pr-4 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
        />
      </label>

      {/* Window picker — chip group. The active chip carries the
          hanko ink, others sit muted. Six chips would crowd the bar
          on mobile, so we keep four canonical horizons (1, 3, 6, 12). */}
      <div
        role="radiogroup"
        aria-label={t("calendar.windowAria")}
        className="inline-flex flex-shrink-0 rounded-full border border-border bg-ink-0/30 p-1"
      >
        {[1, 3, 6, 12].map((n) => {
          const active = windowMonths === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setWindowMonths(n)}
              className={`rounded-full px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition ${
                active
                  ? "bg-hanko text-washi shadow-md"
                  : "text-washi-muted hover:text-washi"
              }`}
            >
              {n}M
            </button>
          );
        })}
      </div>

      {/* View toggle — Agenda / Month. Hidden on mobile since the
          month grid is unreadable below md. */}
      <div
        role="radiogroup"
        aria-label={t("calendar.viewAria")}
        className="hidden flex-shrink-0 rounded-full border border-border bg-ink-0/30 p-1 md:inline-flex"
      >
        {[
          { id: "agenda", label: t("calendar.viewAgenda"), kanji: "暦" },
          { id: "month", label: t("calendar.viewMonth"), kanji: "月" },
        ].map((opt) => {
          const active = view === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setView(opt.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition ${
                active
                  ? "bg-washi/15 text-washi shadow-inner"
                  : "text-washi-muted hover:text-washi"
              }`}
            >
              <span aria-hidden className="font-jp text-[12px] leading-none">
                {opt.kanji}
              </span>
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Subscribe — opens the ICS modal. Moegi-styled to align with
          the rest of the calendar's anticipation-tier vocabulary; the
          tiny RSS-style glyph reads as "feed" without needing copy.
          ── Online gate ──
          The subscribe modal mints a server-side ICS token (no
          offline analogue: the calendar feed can be cached, but
          minting the URL and emitting the bearer token both
          require a live server). When `online === false`, the
          button is disabled, swap to the offline glyph 圏 and the
          tooltip explains why. */}
      <button
        type="button"
        onClick={onSubscribe}
        disabled={!online}
        title={
          online
            ? t("calendar.subscribeTitle")
            : t("calendar.subscribeOfflineHint")
        }
        aria-label={
          online
            ? t("calendar.subscribeTitle")
            : t("calendar.subscribeOfflineHint")
        }
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-moegi/40 bg-moegi/5 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-moegi-muted transition hover:border-moegi/70 hover:bg-moegi/15 hover:text-moegi disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-moegi/40 disabled:hover:bg-moegi/5 disabled:hover:text-moegi-muted"
      >
        {online ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
            <circle cx="5" cy="19" r="1" />
          </svg>
        ) : (
          <span aria-hidden="true" className="font-jp text-[12px] leading-none">
            圏
          </span>
        )}
        <span className="hidden sm:inline">
          {online ? t("calendar.subscribe") : t("calendar.subscribeOffline")}
        </span>
      </button>

      {/* Refresh — explicit re-fetch (vs the nightly cron). Spinning
          when fetching so the user knows the click landed. */}
      <button
        type="button"
        onClick={() => onRefetch()}
        title={t("calendar.refreshTitle")}
        className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full border border-border bg-ink-0/30 text-washi-muted transition hover:border-hanko/50 hover:text-washi"
        aria-label={t("calendar.refreshTitle")}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 1 1 3 6.7" />
          <polyline points="3 21 3 14 10 14" />
        </svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Agenda view — kakemono scroll
// ─────────────────────────────────────────────────────────────────

function AgendaView({ byMonth, today, navigate, t }) {
  return (
    <div
      className="relative space-y-14 animate-fade-up"
      style={{ animationDelay: "180ms" }}
    >
      {/* 線 · Vertical scroll-line. A faint hanko-red strand running
          down the left of the agenda mimics the central crease of a
          folded kakemono. Clamped to the agenda height via absolute +
          inset-y-0 so it auto-extends with the content. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-[1.45rem] top-0 hidden w-px bg-gradient-to-b from-hanko/40 via-hanko/15 to-transparent md:block"
      />
      {byMonth.map(({ key, label, kanji, releases }, idx) => (
        <MonthBlock
          key={key}
          label={label}
          kanji={kanji}
          releases={releases}
          today={today}
          navigate={navigate}
          t={t}
          delayMs={idx * 60}
        />
      ))}
    </div>
  );
}

function MonthBlock({ label, kanji, releases, today, navigate, t, delayMs }) {
  return (
    <section
      className="relative animate-fade-up"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {/* Month header — monumental display type, rotation -1° to feel
          hand-stamped. The kanji sits to the left, italic Latin name
          to its right; the year shrinks into a mono caption above. */}
      <div className="mb-6 flex items-end gap-4 md:gap-6">
        <span
          aria-hidden
          className="font-jp text-5xl font-bold leading-none text-hanko md:text-6xl"
          style={{ transform: "rotate(-2deg)" }}
        >
          {kanji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {label.year}
          </p>
          <h2 className="mt-1 font-display text-3xl font-semibold italic leading-tight text-washi md:text-4xl">
            {label.month}
          </h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
          {t("calendar.monthCount", { n: releases.length })}
        </span>
      </div>

      {/* Ema-style cards list. Each card is hung off the central
          spine line — small badge dot + offset card. Slight rotation
          alternates so the column doesn't feel mechanical. */}
      <ul className="space-y-3">
        {releases.map((rel, i) => (
          <ReleaseCard
            key={rel.id}
            release={rel}
            today={today}
            navigate={navigate}
            t={t}
            tilt={i % 2 === 0 ? -0.4 : 0.6}
          />
        ))}
      </ul>
    </section>
  );
}

function ReleaseCard({ release, today, navigate, t, tilt = 0 }) {
  const releaseDate = useMemo(
    () => new Date(release.release_date),
    [release.release_date],
  );
  const days = daysBetween(today, releaseDate);
  const isImminent = days <= 7;
  const isToday = days === 0;

  // Date triplet — day number monumental, weekday + month abbreviated.
  const dayNum = releaseDate.getDate();
  const weekday = releaseDate
    .toLocaleDateString(undefined, { weekday: "short" })
    .toUpperCase();
  const monthShort = releaseDate.toLocaleDateString(undefined, {
    month: "short",
  });

  const open = () => {
    // Navigate to the series MangaPage with state hinting the volume
    // to spotlight. MangaPage doesn't yet act on this hint (left for
    // a follow-up tweak); the navigate alone gets the user there.
    navigate("/mangapage", {
      state: {
        manga: { mal_id: release.mal_id, name: release.manga_name },
        openVolumeId: release.id,
      },
      viewTransition: true,
    });
  };

  return (
    <li
      className="group relative md:pl-16"
      style={{
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
      }}
    >
      {/* Spine dot — anchors the card to the kakemono's central
          line. Imminent → sakura, otherwise moegi. Today → larger
          gold ring + pulse so the eye snaps to it on entry. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute left-[1.10rem] top-5 hidden h-3 w-3 rounded-full md:block ${
          isToday
            ? "bg-gold ring-4 ring-gold/40 animate-pulse-glow"
            : isImminent
              ? "bg-sakura ring-2 ring-sakura/40"
              : "bg-moegi ring-2 ring-moegi/35"
        }`}
      />

      <button
        type="button"
        onClick={open}
        className={`group/card flex w-full items-stretch gap-4 overflow-hidden rounded-xl border bg-ink-1/50 p-4 text-left backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-ink-1/70 focus:outline-none focus:ring-2 focus:ring-hanko/40 ${
          isToday
            ? "border-gold/50 shadow-[0_0_25px_-6px_rgba(201,169,97,0.45)]"
            : isImminent
              ? "border-sakura/50"
              : "border-border hover:border-moegi/35"
        }`}
        aria-label={t("calendar.cardAria", {
          name: release.manga_name,
          n: release.vol_num,
          date: formatLocaleLong(release.release_date),
        })}
      >
        {/* Date block — three-line stack: number, weekday, month.
            Number gets monumental display type so the eye lands on
            it first and the rest decodes in seconds. */}
        <div
          className={`flex w-16 flex-shrink-0 flex-col items-center justify-center rounded-lg ${
            isToday
              ? "bg-gradient-to-br from-gold/20 to-gold/5"
              : isImminent
                ? "bg-gradient-to-br from-sakura/15 to-sakura/5"
                : "bg-ink-0/40"
          }`}
        >
          <span
            className={`font-display text-3xl font-semibold italic leading-none ${
              isToday
                ? "text-gold"
                : isImminent
                  ? "text-sakura"
                  : "text-washi"
            }`}
          >
            {dayNum}
          </span>
          <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-washi-dim">
            {weekday}
          </span>
          <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-washi-muted">
            {monthShort}
          </span>
        </div>

        {/* Cover thumbnail */}
        {release.image_url_jpg ? (
          <span
            className={`relative h-20 w-14 flex-shrink-0 overflow-hidden rounded border ${
              isToday
                ? "border-gold/60"
                : isImminent
                  ? "border-sakura/60"
                  : "border-border"
            }`}
          >
            <img
              referrerPolicy="no-referrer"
              src={release.image_url_jpg}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-full w-full select-none object-cover brightness-55 saturate-50 transition-all duration-500 group-hover/card:brightness-90"
            />
            <span className="pointer-events-none absolute inset-0 bg-ink-0/40" />
            <span
              className={`pointer-events-none absolute bottom-0.5 right-0.5 grid min-h-4 min-w-4 place-items-center rounded-sm px-1 font-mono text-[9px] font-bold leading-none shadow ${
                isImminent ? "bg-sakura text-ink-0" : "bg-moegi text-ink-0"
              }`}
            >
              {release.vol_num}
            </span>
          </span>
        ) : (
          <span
            className={`grid h-20 w-14 flex-shrink-0 place-items-center rounded border bg-ink-2 font-mono text-base font-bold ${
              isImminent
                ? "border-sakura text-sakura"
                : "border-moegi/60 text-moegi"
            }`}
          >
            {release.vol_num}
          </span>
        )}

        {/* Body — series name + countdown + meta */}
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold leading-tight text-washi md:text-lg">
            {release.manga_name}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            {t("calendar.volumeLabel", { n: release.vol_num })}
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                isToday
                  ? "border-gold/50 bg-gold/10 text-gold"
                  : isImminent
                    ? "border-sakura/45 bg-sakura/10 text-sakura"
                    : "border-moegi/40 bg-moegi/10 text-moegi"
              }`}
            >
              <span className="font-jp text-[11px] font-bold leading-none">
                来
              </span>
              {isToday
                ? t("calendar.today")
                : t("calendar.countdownDays", { n: days })}
            </span>
            {release.origin && release.origin !== "manual" && (
              <span className="font-mono text-[10px] text-washi-dim">
                {t("calendar.via", { source: release.origin })}
              </span>
            )}
          </div>
        </div>

        {/* Trailing arrow — subtle, only visible on hover so it
            doesn't compete with the date block. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="hidden h-5 w-5 self-center text-washi-muted transition-all duration-300 group-hover/card:translate-x-1 group-hover/card:text-washi md:block"
          aria-hidden="true"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────
// Month grid view — denser scan
// ─────────────────────────────────────────────────────────────────

function MonthGridView({ byMonth, today, navigate, t }) {
  return (
    <div className="space-y-12 animate-fade-up" style={{ animationDelay: "180ms" }}>
      {byMonth.map(({ key, label, kanji, releases }) => (
        <MonthGrid
          key={key}
          label={label}
          kanji={kanji}
          releases={releases}
          today={today}
          navigate={navigate}
          t={t}
        />
      ))}
    </div>
  );
}

function MonthGrid({ label, kanji, releases, today, navigate, t }) {
  // Build a per-day bucket. Sample month spans ~30 cells; we render
  // a 7-column calendar grid with leading blank cells to align the
  // first row to the correct weekday.
  const grid = useMemo(() => buildMonthGrid(label, releases), [label, releases]);
  // Memoise the locale-aware weekday header — without this, the
  // 12-month window re-runs `Intl.DateTimeFormat` 7 × 12 = 84 times
  // per render. Locale changes invalidate the cache via the empty
  // deps `[]` boundary on the hook (the parent re-mounts on lang
  // switch via the I18nProvider value identity).
  const headers = useMemo(() => weekdayHeaders(), []);

  return (
    <section className="relative">
      <div className="mb-5 flex items-baseline gap-4">
        <span
          aria-hidden
          className="font-jp text-4xl font-bold leading-none text-hanko"
          style={{ transform: "rotate(-2deg)" }}
        >
          {kanji}
        </span>
        <h2 className="font-display text-2xl font-semibold italic leading-tight text-washi md:text-3xl">
          {label.month}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
          {label.year}
        </span>
      </div>

      <div className="grid grid-cols-7 gap-1.5 rounded-2xl border border-border bg-ink-1/30 p-3 backdrop-blur-sm">
        {/* Weekday labels — locale-aware short form */}
        {headers.map((d) => (
          <div
            key={d}
            className="pb-1.5 text-center font-mono text-[9px] uppercase tracking-wider text-washi-dim"
          >
            {d}
          </div>
        ))}
        {grid.map((cell, i) => {
          if (!cell) {
            return <div key={`b-${i}`} className="min-h-[5.5rem]" />;
          }
          const isToday = sameDay(cell.date, today);
          return (
            <div
              key={cell.date.toISOString()}
              className={`group relative flex min-h-[5.5rem] flex-col gap-1 rounded-md border p-1.5 transition ${
                isToday
                  ? "border-gold/40 bg-gold/5"
                  : cell.releases.length > 0
                    ? "border-moegi/30 bg-ink-2/40"
                    : "border-transparent"
              }`}
            >
              <span
                className={`font-mono text-[10px] font-semibold ${
                  isToday ? "text-gold" : "text-washi-dim"
                }`}
              >
                {cell.date.getDate()}
              </span>
              {cell.releases.slice(0, 2).map((rel) => (
                <button
                  key={rel.id}
                  type="button"
                  onClick={() =>
                    navigate("/mangapage", {
                      state: {
                        manga: { mal_id: rel.mal_id, name: rel.manga_name },
                        openVolumeId: rel.id,
                      },
                      viewTransition: true,
                    })
                  }
                  title={`${rel.manga_name} · ${t("calendar.volumeLabel", { n: rel.vol_num })}`}
                  className="block w-full truncate rounded bg-moegi/15 px-1 py-0.5 text-left font-mono text-[9px] text-moegi transition hover:bg-moegi/25"
                >
                  {rel.manga_name.split(" ").slice(0, 2).join(" ")} · {rel.vol_num}
                </button>
              ))}
              {cell.releases.length > 2 && (
                <span className="font-mono text-[9px] text-washi-dim">
                  +{cell.releases.length - 2}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// States: loading / error / empty
// ─────────────────────────────────────────────────────────────────

function CalendarSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1].map((s) => (
        <div key={s} className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ onRetry, t }) {
  return (
    <div className="rounded-2xl border border-hanko/30 bg-hanko/5 p-8 text-center">
      <span
        aria-hidden
        className="font-jp text-3xl font-bold leading-none text-hanko"
        style={{ transform: "rotate(-3deg)", display: "inline-block" }}
      >
        災
      </span>
      <p className="mt-3 font-display text-lg italic text-washi">
        {t("calendar.errorTitle")}
      </p>
      <p className="mt-1 text-sm text-washi-muted">{t("calendar.errorBody")}</p>
      <button
        type="button"
        onClick={() => onRetry()}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-hanko/50 bg-hanko/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-washi transition hover:border-hanko hover:bg-hanko hover:text-washi"
      >
        {t("common.retryNow")}
      </button>
    </div>
  );
}

function EmptyState({ hasQuery, t }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-ink-1/40 p-10 text-center">
      <span
        aria-hidden
        className="absolute inset-0 grid select-none place-items-center font-jp text-[18rem] font-bold leading-none text-moegi/[0.06]"
      >
        静
      </span>
      <div className="relative">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-moegi-muted">
          {hasQuery ? t("calendar.emptySearchEyebrow") : t("calendar.emptyEyebrow")}
        </p>
        <p className="mt-3 font-display text-2xl font-light italic text-washi">
          {hasQuery ? t("calendar.emptySearchTitle") : t("calendar.emptyTitle")}
        </p>
        <p className="mt-2 max-w-md mx-auto text-sm text-washi-muted">
          {hasQuery ? t("calendar.emptySearchBody") : t("calendar.emptyBody")}
        </p>
        {!hasQuery && (
          <Link
            to="/dashboard"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-moegi/40 bg-moegi/5 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-moegi transition hover:border-moegi hover:bg-moegi/15"
          >
            <span aria-hidden className="font-jp text-[13px] font-bold leading-none">
              本
            </span>
            {t("calendar.emptyCta")}
          </Link>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers — date math + grouping
// ─────────────────────────────────────────────────────────────────

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function formatYearMonth(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function daysBetween(a, b) {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatLocaleLong(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

const MONTH_KANJI = [
  "睦",
  "如",
  "弥",
  "卯",
  "皐",
  "水",
  "文",
  "葉",
  "長",
  "神",
  "霜",
  "師",
];

/**
 * Group a flat releases list by `YYYY-MM`, preserving date order.
 * Returns an array of `{ key, label: { year, month }, kanji, releases[] }`
 * sorted ascending by month.
 */
function groupByMonth(releases) {
  const buckets = new Map();
  for (const r of releases) {
    const date = new Date(r.release_date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: {
          year: date.getFullYear().toString(),
          month: date.toLocaleDateString(undefined, {
            month: "long",
          }),
        },
        kanji: MONTH_KANJI[date.getMonth()] ?? "月",
        sortKey: date.getFullYear() * 100 + date.getMonth(),
        releases: [],
      });
    }
    buckets.get(key).releases.push(r);
  }
  return Array.from(buckets.values()).sort((a, b) => a.sortKey - b.sortKey);
}

function weekdayHeaders() {
  // Locale-aware Mon–Sun headers. Pick a known Monday so the
  // ordering is predictable across locales (some locales start
  // weeks on Sunday — we sort Mon-first by index).
  const monday = new Date(2024, 0, 1); // Jan 1 2024 is a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toLocaleDateString(undefined, { weekday: "narrow" });
  });
}

function buildMonthGrid(label, releases) {
  const year = parseInt(label.year, 10);
  // Recover month index from the localised name by re-parsing the
  // first release's date. Releases are already grouped by month so
  // the first one's month is canonical.
  if (!releases.length) return [];
  const ref = new Date(releases[0].release_date);
  const month = ref.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Lead-blanks so the first day-of-month cell aligns to the right
  // weekday column. Mon-first weeks → (firstOfMonth.getDay() - 1) mod 7.
  const lead = (firstOfMonth.getDay() + 6) % 7;
  const cells = Array(lead).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dayReleases = releases.filter((r) => {
      const d = new Date(r.release_date);
      return (
        d.getFullYear() === date.getFullYear() &&
        d.getMonth() === date.getMonth() &&
        d.getDate() === date.getDate()
      );
    });
    cells.push({ date, releases: dayReleases });
  }
  // Trailing blanks to fill the last row to a multiple of 7.
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
