import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import DefaultBackground from "./DefaultBackground.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import MarginaliaPaper from "./ui/MarginaliaPaper.jsx";
import { useUpcomingCalendar } from "@/hooks/useUpcomingCalendar.js";
import { useOnline } from "@/hooks/useOnline.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import { useAfterFirstPaint } from "@/hooks/useAfterFirstPaint.js";
import { seriesAwaitingDate } from "@/lib/upcomingPicker.js";
import { useT } from "@/i18n/index.jsx";

import CoverImg from "@/components/ui/CoverImg.jsx";
// Lazy — only mounts the first time the user opens the modal.
const CalendarSubscribeModal = lazy(() =>
  import("./CalendarSubscribeModal.jsx"),
);
// 来 · Noting an upcoming volume from here: pick the series, then the
// same form the series page uses. Both lazy, like the subscribe modal.
const UpcomingSeriesPicker = lazy(() => import("./UpcomingSeriesPicker.jsx"));
const AddUpcomingVolumeModal = lazy(() =>
  import("./AddUpcomingVolumeModal.jsx"),
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

  // ── Add an upcoming volume ──────────────────────────────────────
  // Two steps: `pickerOpen` while the reader chooses the series, then
  // `picked` ({ manga, highest }) holds it while the form is open.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState(null);

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
  // 版元 · Publisher, read from the reader's own library rows (the
  // releases carry the series, not its publisher). "" = all of them.
  const [publisher, setPublisher] = useState("");
  const { data: library } = useLibrary();
  const publisherByMal = useMemo(() => {
    const map = new Map();
    for (const m of library ?? []) {
      const name = (m.publisher ?? "").trim();
      if (name) map.set(m.mal_id, name);
    }
    return map;
  }, [library]);

  // ── Data ────────────────────────────────────────────────────────
  const { releases, isLoading, isError, refetch, isFetching, source } =
    useUpcomingCalendar({ from: range.from, until: range.until });

  // 連 · Connectivity gate. Drives:
  //   • the subscribe-button enabled state (ICS-token endpoint
  //     requires a server round-trip — no offline analogue)
  //   • the optional "served from cache" hint above the toolbar
  //     when the live query failed but Dexie still has data
  const online = useOnline();

  // The publishers this window's releases come from; the filter only
  // shows when there is a choice to make.
  const publishers = useMemo(() => {
    const set = new Set();
    for (const r of releases) {
      const name = publisherByMal.get(r.mal_id);
      if (name) set.add(name);
    }
    return [...set].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [releases, publisherByMal]);
  const activePublisher = publishers.includes(publisher) ? publisher : "";

  const filteredReleases = useMemo(() => {
    let out = releases;
    if (trimmedQuery) {
      out = out.filter((r) => r.manga_name.toLowerCase().includes(trimmedQuery));
    }
    if (activePublisher) {
      out = out.filter((r) => publisherByMal.get(r.mal_id) === activePublisher);
    }
    return out;
  }, [releases, trimmedQuery, activePublisher, publisherByMal]);

  // ── Group by month for both views ───────────────────────────────
  const byMonth = useMemo(() => groupByMonth(filteredReleases), [filteredReleases]);

  // ── Stats for the header eyebrow ────────────────────────────────
  const totalCount = filteredReleases.length;
  const nextRelease = filteredReleases[0] ?? null;
  const daysToNext = nextRelease
    ? Math.max(0, daysBetween(today, parseReleaseDate(nextRelease.release_date)))
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
          className="pointer-events-none absolute right-0 top-12 hidden select-none font-jp text-[18rem] font-bold leading-none text-hanko-bright/[0.045] md:block"
          style={{ writingMode: "vertical-rl", letterSpacing: "0.5rem" }}
        >
          来 月 暦
        </span>

        {/* ── Masthead ──────────────────────────────────────────── */}
        <header className="relative mb-10 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko-bright">
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
          {/* 一 · One row on a phone too — value over label, three columns:
              stacked in a column the strip took ~120 px above the
              toolbar. */}
          <div className="mt-6 grid grid-cols-3 gap-x-3 font-mono text-[11px] uppercase tracking-[0.08em] text-washi-dim sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-6 sm:gap-y-2 sm:tracking-[0.2em]">
            <span className="flex flex-col sm:block">
              <span className="font-display text-2xl italic font-semibold not-italic text-washi">
                {totalCount}
              </span>{" "}
              {t("calendar.statCount")}
            </span>
            {/* 枠 · Always three cells. The two below used to mount only
                once there was something to say, so the strip grew from
                one item to three — and wrapped to three lines on a
                phone — the moment the releases arrived, pushing the
                whole calendar down. A dash holds the place instead. */}
            <span className="flex flex-col sm:block">
              <span className="font-display text-2xl italic font-semibold not-italic text-moegi tabular-nums">
                {daysToNext != null ? `J−${daysToNext}` : "—"}
              </span>{" "}
              {t("calendar.statNext")}
            </span>
            <span className="flex flex-col sm:block">
              <span className="font-display text-2xl italic font-semibold not-italic text-washi tabular-nums">
                {byMonth.length > 0 ? byMonth.length : "—"}
              </span>{" "}
              {t(
                byMonth.length === 1
                  ? "calendar.statMonthsSingular"
                  : "calendar.statMonthsPlural",
              )}
            </span>
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
          publishers={publishers}
          publisher={activePublisher}
          setPublisher={setPublisher}
          windowMonths={windowMonths}
          setWindowMonths={setWindowMonths}
          isFetching={isFetching}
          online={online}
          onRefetch={refetch}
          onSubscribe={() => setSubscribeOpen(true)}
          onAddUpcoming={() => setPickerOpen(true)}
          t={t}
        />

        {/* ── Loading / error / empty states ────────────────────── */}
        {isLoading ? (
          <CalendarSkeleton />
        ) : isError ? (
          <ErrorState onRetry={refetch} t={t} />
        ) : filteredReleases.length === 0 ? (
          <EmptyState
            hasQuery={Boolean(trimmedQuery)}
            online={online}
            onAddUpcoming={() => setPickerOpen(true)}
            t={t}
          />
        ) : view === "agenda" ? (
          <AgendaView
            byMonth={byMonth}
            nextId={nextRelease?.id}
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

        {/* 未定 · Series still coming out with no date — below the
            releases, mounted after the first paint: it reads every
            volume on the device to know which series have one. */}
        {!isLoading && !isError && (
          <AwaitingDate
            online={online}
            onNote={(row) => setPicked({ manga: row.manga, highest: row.highest })}
            today={today}
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

        {/* 来 · Add an upcoming volume: the series first, then the form
            with the next number proposed. The calendar reads its range
            from the server, not from `db.volumes` where the form writes,
            so a save refetches it. */}
        {pickerOpen && (
          <Suspense fallback={null}>
            <UpcomingSeriesPicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onPick={(row) => {
                setPickerOpen(false);
                setPicked(row);
              }}
            />
          </Suspense>
        )}
        {picked && (
          <Suspense fallback={null}>
            <AddUpcomingVolumeModal
              open
              onClose={() => setPicked(null)}
              manga={picked.manga}
              highestKnownVolNum={picked.highest}
              onSaved={() => refetch()}
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
  publishers = [],
  publisher = "",
  setPublisher,
  windowMonths,
  setWindowMonths,
  isFetching,
  online = true,
  onRefetch,
  onSubscribe,
  onAddUpcoming,
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
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-washi-dim transition-colors group-focus-within:text-hanko-bright"
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
          className="w-full rounded-full border border-border bg-ink-0/40 py-2 pl-9 pr-4 text-sm pointer-coarse:py-3 text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
        />
      </label>

      {/* 版元 · Publisher — a native select, only when the window holds
          releases from two publishers or more. */}
      {publishers.length > 1 && (
        <label className="relative flex-shrink-0">
          <span className="sr-only">{t("calendar.publisherAria")}</span>
          <select
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            className={`max-w-[12rem] appearance-none truncate rounded-full border bg-ink-0/40 py-2 pl-4 pr-8 font-mono text-[11px] uppercase tracking-wider transition pointer-coarse:py-3 focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20 ${
              publisher ? "border-gold/60 text-washi" : "border-border text-washi-muted"
            }`}
          >
            <option value="">{t("calendar.publisherAll")}</option>
            {publishers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-washi-dim"
          >
            ▾
          </span>
        </label>
      )}

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
              className={`rounded-full px-3 py-1 font-mono text-[10px] font-semibold uppercase pointer-coarse:min-h-11 tracking-wider transition ${
                active
                  ? "bg-hanko text-on-hanko shadow-md"
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
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] font-semibold uppercase pointer-coarse:min-h-11 tracking-wider transition ${
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

      {/* 来 · Add an upcoming volume — the reader picks the series, then
          the form the series page uses. Needs the server to save, so it
          is disabled offline like the subscribe button beside it. */}
      <button
        type="button"
        onClick={onAddUpcoming}
        disabled={!online}
        title={
          online
            ? t("calendar.addUpcomingTitle")
            : t("manga.upcomingAddManualOfflineHint")
        }
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-moegi/40 bg-moegi/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider pointer-coarse:min-h-11 text-moegi transition hover:border-moegi/70 hover:bg-moegi/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-moegi/40 disabled:hover:bg-moegi/10"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {/* The words name the button at every width — hidden from sight
            on a phone, not from a screen reader — and the sentence in
            `title` describes it, so a voice command can say what it
            sees (WCAG 2.5.3). */}
        <span className="sr-only sm:not-sr-only">{t("calendar.addUpcoming")}</span>
      </button>

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
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-moegi/40 bg-moegi/5 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider pointer-coarse:min-h-11 text-moegi-muted transition hover:border-moegi/70 hover:bg-moegi/15 hover:text-moegi disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-moegi/40 disabled:hover:bg-moegi/5 disabled:hover:text-moegi-muted"
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
        className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full border border-border bg-ink-0/30 pointer-coarse:h-11 pointer-coarse:w-11 text-washi-muted transition hover:border-hanko/50 hover:text-washi"
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

function AgendaView({ byMonth, nextId, today, navigate, t }) {
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
          nextId={nextId}
          today={today}
          navigate={navigate}
          t={t}
          delayMs={idx * 60}
        />
      ))}
    </div>
  );
}

function MonthBlock({ label, kanji, releases, nextId, today, navigate, t, delayMs }) {
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
          className="font-jp text-5xl font-bold leading-none text-hanko-bright md:text-6xl"
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
            isNext={rel.id === nextId}
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

function ReleaseCard({ release, isNext = false, today, navigate, t, tilt = 0 }) {
  const releaseDate = useMemo(
    () => parseReleaseDate(release.release_date),
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
      >
        <span className="sr-only">{formatLocaleLong(release.release_date)}</span>
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
          <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-washi-dim">
            {weekday}
          </span>
          <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-washi-muted">
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
            <CoverImg
              referrerPolicy="no-referrer"
              src={release.image_url_jpg}
              sizes="56px"
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
            {/* 次 · The release the header's countdown counts to. */}
            {isNext && !isToday && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold">
                <span aria-hidden="true" className="font-jp text-[11px] font-bold leading-none">
                  次
                </span>
                {t("calendar.next")}
              </span>
            )}
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
          className="font-jp text-4xl font-bold leading-none text-hanko-bright"
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
            className="pb-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-washi-dim"
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
                    })
                  }
                  title={`${rel.manga_name} · ${t("calendar.volumeLabel", { n: rel.vol_num })}`}
                  className="block w-full truncate rounded bg-moegi/15 px-1 py-0.5 text-left font-mono text-[10px] text-moegi transition hover:bg-moegi/25"
                >
                  {rel.manga_name.split(" ").slice(0, 2).join(" ")} · {rel.vol_num}
                </button>
              ))}
              {cell.releases.length > 2 && (
                <span className="font-mono text-[10px] text-washi-dim">
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
        className="font-jp text-3xl font-bold leading-none text-hanko-bright"
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
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-hanko/50 bg-hanko/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-washi hover:text-on-hanko transition hover:border-hanko hover:bg-hanko hover:text-on-hanko"
      >
        {t("common.retryNow")}
      </button>
    </div>
  );
}

function EmptyState({ hasQuery, online = true, onAddUpcoming, t }) {
  // 暦 · Calendar empty state — accent ai (indigo) so it reads
  // as "scheduled / archive blue" rather than the dashboard's
  // hanko cinnabar. The kanji 静 (sei = quiet/still) carries the
  // same calm-season feel the previous revision had; we just
  // give it the marginalia frame so the absence becomes a
  // composed silence rather than blank chrome.
  return (
    <MarginaliaPaper
      glyph="静"
      glyphRotation={-3}
      chapterMark={t("calendar.chapterMark")}
      cornerStamp="月"
      inscription={
        hasQuery ? t("calendar.inscriptionSearched") : t("calendar.inscriptionEmpty")
      }
      accent="ai"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-moegi-muted">
        {hasQuery ? t("calendar.emptySearchEyebrow") : t("calendar.emptyEyebrow")}
      </p>
      <p className="mt-2 font-display text-2xl font-light italic text-washi">
        {hasQuery ? t("calendar.emptySearchTitle") : t("calendar.emptyTitle")}
      </p>
      <p className="mt-2 max-w-md mx-auto text-sm text-washi-muted">
        {hasQuery ? t("calendar.emptySearchBody") : t("calendar.emptyBody")}
      </p>
      {!hasQuery && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-full border border-ai/40 bg-ai/5 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-ai transition hover:border-ai hover:bg-ai/15 pointer-coarse:min-h-11"
          >
            <span aria-hidden className="font-jp text-[13px] font-bold leading-none">
              本
            </span>
            {t("calendar.emptyCta")}
          </Link>
          {/* 来 · An empty calendar is exactly when a reader who knows
              of an announced volume wants to note it. */}
          <button
            type="button"
            onClick={onAddUpcoming}
            disabled={!online}
            title={online ? undefined : t("manga.upcomingAddManualOfflineHint")}
            className="inline-flex items-center gap-2 rounded-full border border-moegi/40 bg-moegi/5 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-moegi transition hover:border-moegi hover:bg-moegi/15 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
          >
            <span aria-hidden className="font-jp text-[13px] font-bold leading-none">
              来
            </span>
            {t("calendar.emptyAddCta")}
          </button>
        </div>
      )}
    </MarginaliaPaper>
  );
}

// ─────────────────────────────────────────────────────────────────
// No date yet
// ─────────────────────────────────────────────────────────────────

const AWAITING_PREVIEW = 6;

function AwaitingDate(props) {
  // The volume table is read only once the releases are on screen.
  const painted = useAfterFirstPaint();
  return painted ? <AwaitingDateList {...props} /> : null;
}

function AwaitingDateList({ online, onNote, today, t }) {
  const { data: library } = useLibrary();
  const { data: volumes } = useAllVolumes();
  const rows = useMemo(
    () => seriesAwaitingDate(library, volumes, today),
    [library, volumes, today],
  );
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, AWAITING_PREVIEW);
  return (
    <section aria-labelledby="calendar-awaiting" className="mt-16 animate-fade-up">
      <div className="flex items-baseline gap-3">
        <span aria-hidden="true" className="font-jp text-2xl font-bold leading-none text-washi-dim">
          未定
        </span>
        <h2
          id="calendar-awaiting"
          className="font-display text-2xl font-semibold italic leading-tight text-washi"
        >
          {t("calendar.awaitingTitle")}
        </h2>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-washi-dim">
          {t("calendar.awaitingCount", { n: rows.length })}
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-washi-muted">{t("calendar.awaitingIntro")}</p>
      {/* `grid-cols-1`, not the implicit column: that one is as wide as a
          long title, and pushed the button off a phone's screen. */}
      <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((row) => (
          <li
            key={row.manga.mal_id}
            className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-ink-1/40 p-2.5"
          >
            <span className="relative h-12 w-8 flex-shrink-0 overflow-hidden rounded-sm border border-border bg-ink-2">
              {row.manga.image_url_jpg ? (
                <CoverImg
                  referrerPolicy="no-referrer"
                  src={row.manga.image_url_jpg}
                  sizes="32px"
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-washi">
              {row.manga.name}
            </span>
            <button
              type="button"
              onClick={() => onNote(row)}
              disabled={!online}
              title={online ? undefined : t("manga.upcomingAddManualOfflineHint")}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-moegi/40 bg-moegi/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-moegi transition hover:border-moegi/70 hover:bg-moegi/20 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
            >
              <span aria-hidden="true">+</span>
              {t("calendar.awaitingNote", { n: row.next })}
              <span className="sr-only"> — {row.manga.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > AWAITING_PREVIEW && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="mt-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted transition hover:text-washi pointer-coarse:min-h-11"
        >
          {all ? t("calendar.awaitingShowFewer") : t("calendar.awaitingShowAll", { n: rows.length })}
        </button>
      )}
    </section>
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

// Parse a server `release_date` into a timezone-stable LOCAL calendar
// day. The server stores it as a UTC timestamp (frequently midnight
// UTC), so a plain `new Date(iso)` renders in the viewer's local zone
// and shifts a `T00:00:00Z` release to the previous day for anyone west
// of UTC — landing it in the wrong calendar cell and skewing the
// "days until" countdown. Manga releases are date-only in intent, so we
// read the Y-M-D and build a local date, keeping every consumer (cell,
// countdown, month bucket) on the intended day.
//
// Contract for bad input: a null/empty/non-ISO value yields an
// `Invalid Date` (NaN time) — deliberately, NOT the 1970 epoch a bare
// `new Date(null)` would give, which would render as a real (wrong)
// day. Every caller here only ever passes a row's real `release_date`,
// so the Invalid-Date branch is defensive; if it ever fires, an
// "Invalid Date" label is a louder, more honest failure than a silent
// Jan 1 1970 cell.
function parseReleaseDate(value) {
  if (!value) return new Date(NaN);
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(value);
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
    return parseReleaseDate(iso).toLocaleDateString(undefined, {
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
    const date = parseReleaseDate(r.release_date);
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
  const ref = parseReleaseDate(releases[0].release_date);
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
      const d = parseReleaseDate(r.release_date);
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
