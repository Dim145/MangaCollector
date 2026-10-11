import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CoverImage from "./ui/CoverImage.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { useUserSettings } from "@/hooks/useSettings.js";
import { useYearInReview } from "@/hooks/useYearInReview.js";
import { formatCurrency } from "@/utils/price.js";
import { useLang, useT } from "@/i18n/index.jsx";
import BackLink from "@/components/ui/BackLink.jsx";

/**
 * 月 · The month's name in the reader's language. The app's own
 * language, not the browser's: someone reading MangaCollector in
 * French on an English system should not be handed "September".
 */
function monthName(lang, index, style = "long") {
  try {
    return new Intl.DateTimeFormat(lang || undefined, {
      month: style,
    }).format(new Date(2020, index, 1));
  } catch {
    return String(index + 1);
  }
}

export default function YearInReviewPage({ googleUser }) {
  const { year: yearParam, month: monthParam } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const lang = useLang();

  const currentYear = new Date().getFullYear();
  const year = useMemo(() => {
    if (!yearParam) return currentYear;
    const parsed = parseInt(yearParam, 10);
    if (!Number.isFinite(parsed) || parsed < 1990 || parsed > 2100) {
      return currentYear;
    }
    return parsed;
  }, [yearParam, currentYear]);

  // 月 · `/year-in-review/2026/9` is September 2026; no segment is the
  // whole year. The URL is 1-based because that is how a person writes
  // a month; the code is 0-based because that is how `Date` reads one.
  const month = useMemo(() => {
    if (!monthParam) return null;
    const parsed = parseInt(monthParam, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) return null;
    return parsed - 1;
  }, [monthParam]);

  // Redirect a malformed year or month to the canonical URL.
  useEffect(() => {
    const canonical =
      month == null ? `/year-in-review/${year}` : `/year-in-review/${year}/${month + 1}`;
    const current =
      monthParam == null
        ? `/year-in-review/${yearParam ?? year}`
        : `/year-in-review/${yearParam ?? year}/${monthParam}`;
    if (yearParam && current !== canonical) {
      navigate(canonical, { replace: true });
    }
  }, [yearParam, monthParam, year, month, navigate]);

  const { bundle, loading } = useYearInReview(year, month);
  const periodLabel =
    month == null ? String(year) : `${monthName(lang, month)} ${year}`;
  const fileStamp =
    month == null ? String(year) : `${year}-${String(month + 1).padStart(2, "0")}`;
  const { data: settings } = useUserSettings();
  const currencySetting = settings?.currency;

  const accentClass = ACCENT_CLASS[bundle.accentSeason] ?? ACCENT_CLASS.neutral;

  const posterRef = useRef(null);
  const [captureState, setCaptureState] = useState("idle");
  const captureTimerRef = useRef(null);
  useEffect(() => {
    return () => {
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    };
  }, []);

  async function generatePng() {
    if (!posterRef.current) return null;
    // Without this, html-to-image can capture mid-FOUT and rasterise
    // the year numerals in the system fallback font.
    if (typeof document?.fonts?.ready?.then === "function") {
      try {
        await document.fonts.ready;
      } catch {
        /* font loading API absent */
      }
    }
    // 遅 · Fetched on the click that needs it: the poster is viewed far
    // more often than it is saved, and the library rode in the page's
    // own chunk for every view.
    const { toPng } = await import("html-to-image");
    // 表 · Covers the reader has not scrolled to are still being fetched
    // when the button at the top is pressed; a capture taken then has
    // an empty frame where the first volume should be.
    await Promise.all(
      [...posterRef.current.querySelectorAll("img")].map((img) =>
        img.decode ? img.decode().catch(() => {}) : null,
      ),
    );
    return toPng(posterRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      // 地 · The ground the poster is drawn on, in the reader's theme. It
      // was a fixed near-black: a light-theme poster — dark ink on a
      // 40 % paper card — came out dark on dark, its year, genre and
      // series names all but gone.
      backgroundColor:
        getComputedStyle(document.body).backgroundColor || "#0a0908",
      filter: (node) => !(node?.classList?.contains?.("yir-controls")),
    });
  }

  async function handleSave() {
    if (loading || bundle.empty) return;
    setCaptureState("working");
    try {
      const dataUrl = await generatePng();
      if (!dataUrl) throw new Error("capture-failed");

      const filename = `manga-collector-${fileStamp}.png`;
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], filename, { type: "image/png" });

      const canShareFile =
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });

      if (canShareFile && typeof navigator.share === "function") {
        try {
          await navigator.share({
            files: [file],
            title:
              month == null
                ? t("yearReview.shareTitle", { year })
                : t("yearReview.shareTitleMonth", { period: periodLabel }),
          });
          setCaptureState("shared");
        } catch (err) {
          if (err?.name === "AbortError") {
            setCaptureState("idle");
            return;
          }
          triggerDownload(dataUrl, filename);
          setCaptureState("shared");
        }
      } else {
        triggerDownload(dataUrl, filename);
        setCaptureState("shared");
      }

      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
      captureTimerRef.current = setTimeout(
        () => setCaptureState("idle"),
        1800,
      );
    } catch (err) {
      console.error("[YearInReview] capture failed", err);
      setCaptureState("error");
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
      captureTimerRef.current = setTimeout(
        () => setCaptureState("idle"),
        2200,
      );
    }
  }

  return (
    <div className="yir-root mx-auto min-h-screen w-full max-w-[44rem] px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
      {/* Controls sit outside the posterRef so they're skipped by toPng. */}
      {/* Three controls no longer fit beside "back" on a phone: the
          group takes its own line there and returns to the same row
          from `sm` up. */}
      <div className="yir-controls mb-6 flex flex-wrap items-center justify-between gap-3">
        <BackLink to="/profile">{t("common.backToProfile")}</BackLink>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
          <YearSelector current={year} month={month} />
          <MonthSelector current={month} year={year} lang={lang} t={t} />
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || bundle.empty || captureState === "working"}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
              captureState === "shared"
                ? "border-moegi/60 bg-moegi/10 text-moegi"
                : captureState === "error"
                  ? "border-hanko-bright/60 bg-hanko/10 text-hanko-bright"
                  : "border-hanko/40 bg-hanko/10 text-hanko-bright hover:border-hanko/70 hover:bg-hanko/20"
            }`}
          >
            {captureState === "working" ? (
              <>
                <span
                  aria-hidden="true"
                  className="block h-3 w-3 animate-spin rounded-full border border-hanko-bright/30 border-t-hanko-bright"
                />
                {t("yearReview.captureWorking")}
              </>
            ) : captureState === "shared" ? (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("yearReview.captureShared")}
              </>
            ) : captureState === "error" ? (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {t("yearReview.captureError")}
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {t("yearReview.saveCta")}
              </>
            )}
          </button>
        </div>
      </div>

      <article
        ref={posterRef}
        className={`yir-poster relative overflow-hidden rounded-3xl border border-border bg-ink-1/40 px-6 py-12 backdrop-blur sm:px-10 md:px-14 md:py-16 ${accentClass}`}
      >
        <span
          aria-hidden="true"
          className="yir-grain pointer-events-none absolute inset-0 opacity-[0.05]"
        />
        <span
          aria-hidden="true"
          className="yir-vignette pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 35%, transparent 30%, var(--scene-vignette) 100%)",
          }}
        />

        {loading ? (
          <PosterSkeleton />
        ) : bundle.empty ? (
          <EmptyState year={year} month={month} periodLabel={periodLabel} />
        ) : (
          <PosterBody
            bundle={bundle}
            googleUser={googleUser}
            currencySetting={currencySetting}
            periodLabel={periodLabel}
            lang={lang}
            t={t}
          />
        )}
      </article>
    </div>
  );
}

const ACCENT_CLASS = {
  spring: "yir-accent-spring",
  summer: "yir-accent-summer",
  autumn: "yir-accent-autumn",
  winter: "yir-accent-winter",
  neutral: "yir-accent-neutral",
};

// Safari requires the anchor to be in the DOM at click time, so we
// append it before the click and remove it on the next tick.
function triggerDownload(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 0);
}

function YearSelector({ current, month }) {
  const t = useT();
  const navigate = useNavigate();
  const now = new Date().getFullYear();
  const options = [now - 2, now - 1, now];
  return (
    <div
      role="radiogroup"
      aria-label={t("yearReview.yearPicker")}
      className="inline-flex items-stretch overflow-hidden rounded-full border border-border bg-ink-0/40 p-0.5"
    >
      {options.map((y) => {
        const active = y === current;
        return (
          <button
            key={y}
            type="button"
            role="radio"
            aria-checked={active}
            // Changing the year keeps the month: someone comparing
            // two Septembers should not be dropped back into a year.
            onClick={() =>
              navigate(
                month == null
                  ? `/year-in-review/${y}`
                  : `/year-in-review/${y}/${month + 1}`,
              )
            }
            className={`rounded-full px-2.5 py-1 font-mono text-[10px] tracking-wider transition ${
              active
                ? "bg-hanko/20 text-hanko-bright"
                : "text-washi-muted hover:text-washi"
            }`}
          >
            {y}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 月 · Which slice of the year the poster covers. A select rather than
 * twelve chips: thirteen options would take more room than the poster's
 * own header, and a native control is what a phone opens best.
 */
function MonthSelector({ current, year, lang, t }) {
  const navigate = useNavigate();
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="sr-only">{t("yearReview.periodLabel")}</span>
      <select
        value={current == null ? "" : String(current + 1)}
        onChange={(e) => {
          const value = e.target.value;
          navigate(
            value === ""
              ? `/year-in-review/${year}`
              : `/year-in-review/${year}/${value}`,
          );
        }}
        className="rounded-full border border-border bg-ink-0/40 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-washi-muted transition pointer-coarse:min-h-11 hover:text-washi focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
      >
        <option value="">{t("yearReview.wholeYear")}</option>
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i} value={String(i + 1)}>
            {monthName(lang, i)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="my-10 block h-px w-full bg-gradient-to-r from-transparent via-border to-transparent"
    />
  );
}

function PosterBody({
  bundle,
  googleUser,
  currencySetting,
  periodLabel,
  lang,
  t,
}) {
  const {
    year,
    month,
    previous,
    volumesAcquired,
    volumesRead,
    seriesStarted,
    seriesCompleted,
    totalSpent,
    topGenres,
    bestMonth,
    topSeries,
    firstVolume,
    lastVolume,
  } = bundle;

  const displayName = googleUser?.name ?? t("profile.reader");
  const isMonth = month != null;

  return (
    <div className="relative z-10 flex flex-col items-center text-center">
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-washi-dim">
          {isMonth ? `${t("yearReview.monthEyebrow")} · ${year}` : t("yearReview.eyebrow")}
        </p>
        {/* A month's name is a word, not four numerals: it needs a
            smaller size to hold the same line, and no tracking-tight. */}
        <h1
          className={`yir-year mt-3 font-display font-light italic leading-[0.85] capitalize text-washi ${
            isMonth
              ? "text-[3.5rem] sm:text-[4.5rem] md:text-[5.5rem]"
              : "text-[6.5rem] tracking-tight sm:text-[8rem] md:text-[10rem]"
          }`}
        >
          {isMonth ? monthName(lang, month) : year}
        </h1>
        <div
          aria-hidden="true"
          className="mt-4 flex items-center justify-center gap-3 text-washi-muted"
        >
          <span className="h-px w-10 bg-border" />
          <span className="font-jp text-2xl font-bold leading-none text-hanko-bright">
            収
          </span>
          <span className="h-px w-10 bg-border" />
        </div>
      </header>

      <section className="mb-2">
        <p className="font-display text-7xl font-semibold italic text-hanko-bright sm:text-8xl">
          {volumesAcquired}
          <span className="ml-2 font-jp text-3xl font-bold not-italic text-washi">
            巻
          </span>
        </p>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.3em] text-washi-muted">
          {isMonth
            ? t("yearReview.headlineCaptionMonth")
            : t("yearReview.headlineCaption")}
        </p>
      </section>

      <Divider />

      <section className="grid w-full max-w-md grid-cols-2 gap-x-8 gap-y-6 text-left">
        <Stat
          value={seriesStarted}
          label={t("yearReview.seriesStarted")}
          tone="moegi"
        />
        <Stat
          value={seriesCompleted}
          label={t("yearReview.seriesCompleted")}
          tone="gold"
        />
        <Stat
          value={volumesRead}
          label={t("yearReview.volumesRead")}
          tone="sakura"
        />
        <Stat
          value={formatCurrency(totalSpent, currencySetting)}
          label={t("yearReview.totalSpent")}
          tone="hanko"
          isCurrency
        />
      </section>

      <Divider />

      {topGenres.length > 0 && (
        <section className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {t("yearReview.topGenreLabel")}
          </p>
          <p className="mt-3 font-display text-3xl font-semibold italic text-washi">
            〜&nbsp;{topGenres[0].name}&nbsp;〜
          </p>
          <p className="mt-2 font-mono text-[11px] tracking-wider text-washi-muted">
            {Math.round(topGenres[0].share * 100)}%
            {topGenres.length > 1 && (
              <span className="ml-3 text-washi-dim">
                · {topGenres
                  .slice(1)
                  .map((g) => g.name)
                  .join(" · ")}
              </span>
            )}
          </p>
        </section>
      )}

      {bestMonth && (
        <section className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {t("yearReview.bestMonthLabel")}
          </p>
          <p className="mt-3 font-display text-2xl font-semibold italic capitalize text-washi">
            {monthName(lang, bestMonth.index)}
          </p>
          <p className="mt-1 font-mono text-[11px] tracking-wider text-washi-muted">
            {t("yearReview.bestMonthHint", { n: bestMonth.count })}
          </p>
        </section>
      )}

      {/* 比 · The one number a month has that a year does not: the
          month before it. Shown even when it is a fall — a recap that
          only ever congratulates is not a record of anything. */}
      {previous && (
        <section className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {t("yearReview.vsPrevLabel", {
              month: monthName(lang, previous.month),
            })}
          </p>
          <p
            className={`mt-3 font-display text-3xl font-semibold italic ${
              previous.delta > 0
                ? "text-moegi"
                : previous.delta < 0
                  ? "text-washi-muted"
                  : "text-washi"
            }`}
          >
            {previous.delta > 0 ? `+${previous.delta}` : previous.delta}
          </p>
          <p className="mt-1 font-mono text-[11px] tracking-wider text-washi-muted">
            {t("yearReview.vsPrevHint", { n: previous.count })}
          </p>
        </section>
      )}

      {topSeries && (
        <section className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {t("yearReview.topSeriesLabel")}
          </p>
          <p className="mt-3 font-display text-2xl font-semibold italic text-washi">
            {topSeries.name}
          </p>
          <p className="mt-1 font-mono text-[11px] tracking-wider text-washi-muted">
            {isMonth
              ? t("yearReview.topSeriesHintMonth", { n: topSeries.count })
              : t("yearReview.topSeriesHint", { n: topSeries.count })}
          </p>
        </section>
      )}

      <Divider />

      <section className="flex w-full max-w-md flex-col items-center gap-8 sm:flex-row sm:justify-between sm:gap-6">
        <Bookend
          kanji="始"
          label={t("yearReview.bookendStart")}
          volume={firstVolume}
          t={t}
        />
        <span
          aria-hidden="true"
          className="hidden h-16 w-px bg-border sm:block"
        />
        <Bookend
          kanji="終"
          label={t("yearReview.bookendEnd")}
          volume={lastVolume}
          t={t}
          align="end"
        />
      </section>

      <Divider />

      <footer className="text-center">
        <p className="font-display text-base italic text-washi">
          @{displayName}
        </p>
        <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.4em] text-washi-dim">
          MangaCollector · {periodLabel}
        </p>
      </footer>
    </div>
  );
}

function Stat({ value, label, tone = "hanko", isCurrency = false }) {
  const toneClasses = {
    hanko: "text-hanko-bright",
    gold: "text-gold",
    moegi: "text-moegi",
    sakura: "text-sakura",
  };
  return (
    <div>
      <p
        className={`font-display font-semibold leading-none ${
          isCurrency ? "text-2xl" : "text-4xl italic"
        } ${toneClasses[tone] ?? toneClasses.hanko}`}
      >
        {value}
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted">
        {label}
      </p>
    </div>
  );
}

function Bookend({ kanji, label, volume, t, align = "start" }) {
  const alignClass = align === "end" ? "items-center sm:items-end" : "items-center sm:items-start";
  if (!volume) {
    return (
      <div className={`flex flex-1 flex-col gap-2 ${alignClass}`}>
        <span
          aria-hidden="true"
          className="font-jp text-3xl font-bold leading-none text-hanko-bright"
        >
          {kanji}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
          {label}
        </span>
        <span className="text-xs italic text-washi-muted">
          {t("yearReview.bookendNone")}
        </span>
      </div>
    );
  }

  const date = new Date(volume.date).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  const textAlign = align === "end" ? "sm:text-right" : "sm:text-left";

  return (
    <div className={`flex flex-1 flex-col gap-2 text-center ${alignClass} ${textAlign}`}>
      <span
        aria-hidden="true"
        className="font-jp text-3xl font-bold leading-none text-hanko-bright"
      >
        {kanji}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
        {label} · {date}
      </span>
      <Link
        to={`/manga/${volume.mal_id}`}
        className="group flex items-center gap-3 rounded-md transition hover:opacity-90"
      >
        <span className="block h-14 w-10 shrink-0 overflow-hidden rounded-sm shadow-md ring-1 ring-border">
          {/* Mounted and fetched at once, not when scrolled to: the
              poster is saved as an image from the button at its top. */}
          <CoverImage
            src={volume.cover}
            sizes="40px"
            alt={volume.seriesName}
            className="h-full w-full object-cover"
            imgClassName="h-full w-full object-cover"
            fallbackKanji="巻"
            priority
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm italic text-washi group-hover:text-hanko-bright">
            {volume.seriesName}
          </span>
          <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
            {t("yearReview.volumeShort", { n: volume.vol_num })}
          </span>
        </span>
      </Link>
    </div>
  );
}

function PosterSkeleton() {
  return (
    <div className="relative z-10 flex flex-col items-center text-center">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-4 h-32 w-72" />
      <Skeleton className="mt-10 h-20 w-44" />
      <div className="mt-12 grid w-full max-w-md grid-cols-2 gap-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-12 h-8 w-40" />
      <Skeleton className="mt-3 h-4 w-32" />
    </div>
  );
}

function EmptyState({ year, month, periodLabel }) {
  const t = useT();
  const isMonth = month != null;
  return (
    <div className="relative z-10 mx-auto flex max-w-md flex-col items-center text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-washi-dim">
        {isMonth ? t("yearReview.monthEyebrow") : t("yearReview.eyebrow")}
      </p>
      <h1
        className={`mt-3 font-display font-light italic leading-[0.9] capitalize text-washi-dim ${
          isMonth ? "text-4xl sm:text-5xl" : "text-7xl tracking-tight sm:text-8xl"
        }`}
      >
        {periodLabel ?? year}
      </h1>
      <span
        aria-hidden="true"
        className="mt-6 font-jp text-3xl font-bold leading-none text-hanko-bright"
      >
        収
      </span>
      <h2 className="mt-6 font-display text-2xl font-semibold italic text-washi">
        {t("yearReview.emptyTitle")}
      </h2>
      <p className="mt-3 max-w-prose text-sm text-washi-muted">
        {isMonth ? t("yearReview.emptyBodyMonth") : t("yearReview.emptyBody")}
      </p>
      <Link
        to="/dashboard"
        className="mt-8 inline-flex items-center gap-1.5 rounded-full border border-hanko/40 bg-hanko/10 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-hanko-bright transition hover:border-hanko/70 hover:bg-hanko/20"
      >
        {t("yearReview.emptyCta")}
      </Link>
    </div>
  );
}
