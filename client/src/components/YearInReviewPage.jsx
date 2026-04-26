import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toPng } from "html-to-image";
import CoverImage from "./ui/CoverImage.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { useUserSettings } from "@/hooks/useSettings.js";
import { useYearInReview } from "@/hooks/useYearInReview.js";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 収 · /year-in-review/:year? — Year-in-review poster page.
 *
 * A vertical-poster surface (max-w narrow, generous vertical rhythm,
 * intentional negative space) summarising the user's year of
 * collecting in nine "stanzas":
 *
 *   1. Header  — the year as a giant numeral + the kanji 収 (harvest)
 *   2. Headline — total volumes acquired this year
 *   3. Stats   — series started / completed / volumes read / spent
 *   4. Genres  — top 3 with proportions
 *   5. Month   — busiest month (by volumes acquired)
 *   6. Series  — most-collected series this year
 *   7. Bookend — first volume of the year (始)
 *   8. Bookend — last volume of the year (終)
 *   9. Footer  — display name + branding
 *
 * The accent palette (a single decorative tint) follows the season of
 * the user's busiest month — winter → washi cool, spring → sakura,
 * summer → moegi, autumn → gold. Gives every year's poster a unique
 * dominant tone keyed to the user's actual rhythm.
 *
 * Print-friendly via `@media print` rules in index.css; the poster
 * also screenshots cleanly via the browser's native tools because
 * the layout is fixed-width and self-contained.
 */
export default function YearInReviewPage({ googleUser }) {
  const { year: yearParam } = useParams();
  const navigate = useNavigate();
  const t = useT();

  const currentYear = new Date().getFullYear();
  const year = useMemo(() => {
    if (!yearParam) return currentYear;
    const parsed = parseInt(yearParam, 10);
    if (!Number.isFinite(parsed) || parsed < 1990 || parsed > 2100) {
      return currentYear;
    }
    return parsed;
  }, [yearParam, currentYear]);

  // Redirect a malformed year to the canonical current-year URL.
  useEffect(() => {
    if (yearParam && String(year) !== yearParam) {
      navigate(`/year-in-review/${year}`, { replace: true });
    }
  }, [yearParam, year, navigate]);

  const { bundle, loading } = useYearInReview(year);
  const { data: settings } = useUserSettings();
  const currencySetting = settings?.currency;

  const accentClass = ACCENT_CLASS[bundle.accentSeason] ?? ACCENT_CLASS.neutral;

  // ── Image capture ────────────────────────────────────────────────
  // Ref points at the `.yir-poster` element so `toPng` only rasterises
  // the poster body, not the surrounding chrome (back link, year picker,
  // save button — none of which belong on the shared image).
  const posterRef = useRef(null);
  // `idle | working | shared | error` — drives the button label so the
  // user gets feedback instead of clicking blindly while the worker
  // thread chugs through the PNG encoding.
  const [captureState, setCaptureState] = useState("idle");
  const captureTimerRef = useRef(null);
  useEffect(() => {
    return () => {
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    };
  }, []);

  /**
   * Render the poster element to a PNG data URL at 2× pixel density.
   *
   * Two correctness details that bite if omitted:
   *   1. `await document.fonts.ready` — without it, `html-to-image`
   *      sometimes captures the page mid-FOUT and the year numerals
   *      land in the system fallback font for one frame, which is
   *      exactly what gets rasterised.
   *   2. `backgroundColor` matches the page bg so the PNG has a
   *      defined background (no transparent corners on dark themes).
   *
   * Filename is meaningful (`manga-collector-{year}.png`) so the file
   * sorts and reads well in Downloads.
   */
  async function generatePng() {
    if (!posterRef.current) return null;
    if (typeof document?.fonts?.ready?.then === "function") {
      try {
        await document.fonts.ready;
      } catch {
        /* font loading API absent or rejected — proceed anyway */
      }
    }
    return toPng(posterRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      // Match the dark canvas behind the poster so the PNG has a
      // proper bg even when the user's OS preview puts it on white.
      backgroundColor: "#0a0908",
      filter: (node) => {
        // Skip the on-screen control row if it ever lived inside the
        // captured tree. (It currently doesn't — controls are siblings
        // of `.yir-poster`. Defensive belt + braces.)
        return !(node?.classList?.contains?.("yir-controls"));
      },
    });
  }

  /**
   * Save → either share via the Web Share API (mobile / supported
   * browsers) or fall back to a plain download. We always try share
   * first when the runtime claims it can take a file payload — that
   * gives the user the system "share to Instagram / Telegram /
   * AirDrop / …" sheet, which is the canonical UX for "I made an
   * image, send it somewhere". Browsers without `canShare({ files })`
   * (Safari macOS in some versions, older Firefox) get the download.
   */
  async function handleSave() {
    if (loading || bundle.empty) return;
    setCaptureState("working");
    try {
      const dataUrl = await generatePng();
      if (!dataUrl) throw new Error("capture-failed");

      const filename = `manga-collector-${year}.png`;
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
            title: t("yearReview.shareTitle", { year }),
          });
          setCaptureState("shared");
        } catch (err) {
          // User cancelled the share sheet — that's not an error,
          // just go back to idle.
          if (err?.name === "AbortError") {
            setCaptureState("idle");
            return;
          }
          // Any other share failure → fall through to download.
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
      {/* ── Top control strip — kept out of the captured PNG via the
          posterRef boundary; the ref is attached to the article below
          so html-to-image only walks the poster subtree. */}
      <div className="yir-controls mb-6 flex items-center justify-between gap-3">
        <Link
          to="/profile"
          className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim transition hover:text-washi"
        >
          ← {t("common.back")}
        </Link>
        <div className="flex items-center gap-2">
          <YearSelector current={year} />
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

      {/* ── The poster itself ── */}
      <article
        ref={posterRef}
        className={`yir-poster relative overflow-hidden rounded-3xl border border-border bg-ink-1/40 px-6 py-12 backdrop-blur sm:px-10 md:px-14 md:py-16 ${accentClass}`}
      >
        {/* Faint grain texture for the printed-poster feel; opacity tuned
            low enough to coexist with both light and dark themes. */}
        <span
          aria-hidden="true"
          className="yir-grain pointer-events-none absolute inset-0 opacity-[0.05]"
        />
        {/* Subtle vignette — corners darken to draw the eye toward the
            year + headline numerals. */}
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
          <EmptyState year={year} />
        ) : (
          <PosterBody
            bundle={bundle}
            googleUser={googleUser}
            currencySetting={currencySetting}
            t={t}
          />
        )}
      </article>
    </div>
  );
}

/**
 * Per-season accent palette — a single class applied at the poster
 * root that subtly shifts the radial gradients underneath the title.
 * Each token resolves to its existing `--scene-*` CSS variable in
 * light/dark mode, so the page looks correct in both themes.
 */
const ACCENT_CLASS = {
  spring: "yir-accent-spring",
  summer: "yir-accent-summer",
  autumn: "yir-accent-autumn",
  winter: "yir-accent-winter",
  neutral: "yir-accent-neutral",
};

/**
 * Trigger a synthetic-anchor download for a data URL. Cleans up the
 * anchor on the next tick — Chromium-based browsers leak the element
 * if it stays attached, and Safari requires it to be in the DOM at
 * click time, so the choreography is "append → click → remove".
 */
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

function YearSelector({ current }) {
  const navigate = useNavigate();
  const now = new Date().getFullYear();
  const options = [now - 2, now - 1, now];
  return (
    <div
      role="radiogroup"
      aria-label="Year"
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
            onClick={() => navigate(`/year-in-review/${y}`)}
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

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="my-10 block h-px w-full bg-gradient-to-r from-transparent via-border to-transparent"
    />
  );
}

function PosterBody({ bundle, googleUser, currencySetting, t }) {
  const {
    year,
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

  return (
    <div className="relative z-10 flex flex-col items-center text-center">
      {/* ── 1. Header — the year + 収 watermark ── */}
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-washi-dim">
          {t("yearReview.eyebrow")}
        </p>
        <h1 className="yir-year mt-3 font-display text-[6.5rem] font-light italic leading-[0.85] tracking-tight text-washi sm:text-[8rem] md:text-[10rem]">
          {year}
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

      {/* ── 2. Headline number ── */}
      <section className="mb-2">
        <p className="font-display text-7xl font-semibold italic text-hanko-bright sm:text-8xl">
          {volumesAcquired}
          <span className="ml-2 font-jp text-3xl font-bold not-italic text-washi">
            巻
          </span>
        </p>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.3em] text-washi-muted">
          {t("yearReview.headlineCaption")}
        </p>
      </section>

      <Divider />

      {/* ── 3. Secondary stats — typographic grid ── */}
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

      {/* ── 4. Top genre ── */}
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

      {/* ── 5. Best month ── */}
      {bestMonth && (
        <section className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {t("yearReview.bestMonthLabel")}
          </p>
          <p className="mt-3 font-display text-2xl font-semibold italic capitalize text-washi">
            {bestMonth.label}
          </p>
          <p className="mt-1 font-mono text-[11px] tracking-wider text-washi-muted">
            {t("yearReview.bestMonthHint", { n: bestMonth.count })}
          </p>
        </section>
      )}

      {/* ── 6. Top series ── */}
      {topSeries && (
        <section className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {t("yearReview.topSeriesLabel")}
          </p>
          <p className="mt-3 font-display text-2xl font-semibold italic text-washi">
            {topSeries.name}
          </p>
          <p className="mt-1 font-mono text-[11px] tracking-wider text-washi-muted">
            {t("yearReview.topSeriesHint", { n: topSeries.count })}
          </p>
        </section>
      )}

      <Divider />

      {/* ── 7-8. Bookends ── */}
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

      {/* ── 9. Footer signature ── */}
      <footer className="text-center">
        <p className="font-display text-base italic text-washi">
          @{displayName}
        </p>
        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.4em] text-washi-dim">
          MangaCollector · {year}
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
          <CoverImage
            src={volume.cover}
            alt={volume.seriesName}
            className="h-full w-full object-cover"
            imgClassName="h-full w-full object-cover"
            fallbackKanji="巻"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm italic text-washi group-hover:text-hanko-bright">
            {volume.seriesName}
          </span>
          <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-washi-dim">
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

function EmptyState({ year }) {
  const t = useT();
  return (
    <div className="relative z-10 mx-auto flex max-w-md flex-col items-center text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-washi-dim">
        {t("yearReview.eyebrow")}
      </p>
      <h1 className="mt-3 font-display text-7xl font-light italic leading-[0.9] tracking-tight text-washi/60 sm:text-8xl">
        {year}
      </h1>
      <span
        aria-hidden="true"
        className="mt-6 font-jp text-3xl font-bold leading-none text-hanko-bright/60"
      >
        収
      </span>
      <h2 className="mt-6 font-display text-2xl font-semibold italic text-washi">
        {t("yearReview.emptyTitle")}
      </h2>
      <p className="mt-3 max-w-prose text-sm text-washi-muted">
        {t("yearReview.emptyBody")}
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
