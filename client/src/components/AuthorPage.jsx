import { useContext, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import { useLibrary } from "@/hooks/useLibrary.js";
import { hasToBlurImage } from "@/utils/library.js";
import CoverImage from "./ui/CoverImage.jsx";
import SettingsContext from "@/SettingsContext.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 作家 Sakka · Author monograph.
 *
 * The page is a catalogue raisonné for a single mangaka: a refined
 * editorial document presenting their body of work in the user's
 * library as a coherent corpus, not just a search-result grid.
 *
 * Composition:
 *   • HERO — author name as a typographic masthead + vertical kanji
 *     watermark + headline stats (series / volumes / completion).
 *   • GENRE SIGNATURE — a horizontal segmented bar showing the top
 *     genres recurring across the author's work, weighted by the
 *     number of series each genre appears in. Becomes the author's
 *     editorial fingerprint.
 *   • PUBLICATIONS — the actual series, rendered as poster cards
 *     (cover + title + ownership ribbon). Slight per-card rotation
 *     alternating ±0.4° so the gallery reads as hand-pinned to a
 *     wall, not a spreadsheet of tiles.
 *
 * Cover sizing fix: the previous revision passed `className="h-28
 * w-20"` to `<CoverImage>` which only sized the WRAPPER span; the
 * inner `<img>` had no constraint and rendered at its natural pixel
 * size. We now pass `imgClassName="h-full w-full object-cover"` so
 * the photo inherits its slot's dimensions instead of blowing the
 * page out.
 */
export default function AuthorPage() {
  const { name: rawName } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const { adult_content_level } = useContext(SettingsContext);
  // 待 · `isInitialLoad` is the cold-start gate: true while Dexie
  // hasn't answered yet AND the network refetch is still in flight.
  // Without it, a hard reload of /author/test renders the
  // NotFoundPanel for ~200-800ms before the library populates, which
  // looks like a permanent 404 to the user. We render the
  // skeleton-shaped hero in the meantime so the surface feels alive.
  const { data: library, isInitialLoad } = useLibrary();

  const targetName = useMemo(() => {
    try {
      return decodeURIComponent(rawName ?? "").trim();
    } catch {
      return rawName ?? "";
    }
  }, [rawName]);

  const matches = useMemo(() => {
    const target = targetName.toLowerCase();
    if (!target || !library) return [];
    return library
      .filter((m) => (m.author ?? "").toLowerCase() === target)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
  }, [library, targetName]);

  const stats = useMemo(() => {
    if (matches.length === 0) {
      return {
        seriesCount: 0,
        totalVolumes: 0,
        totalOwned: 0,
        completionPct: 0,
        topGenres: [],
      };
    }
    let totalVolumes = 0;
    let totalOwned = 0;
    const genreFreq = new Map();
    for (const m of matches) {
      totalVolumes += m.volumes ?? 0;
      totalOwned += m.volumes_owned ?? 0;
      // Count GENRES per series (not per-volume) — the signature is
      // "genres this author touches across their corpus", not "what
      // genre dominates by volume count".
      for (const g of m.genres ?? []) {
        const trimmed = g.trim();
        if (!trimmed) continue;
        genreFreq.set(trimmed, (genreFreq.get(trimmed) ?? 0) + 1);
      }
    }
    const completionPct =
      totalVolumes > 0 ? Math.round((totalOwned / totalVolumes) * 100) : 0;
    const topGenres = Array.from(genreFreq.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    return { seriesCount: matches.length, totalVolumes, totalOwned, completionPct, topGenres };
  }, [matches]);

  // Display name comes from the first matched row so we preserve the
  // casing the user typed when they added the series — even if the
  // URL was lowercased by a copy-paste from another tool.
  const displayName = matches[0]?.author ?? targetName;

  if (!targetName) {
    return (
      <DefaultBackground>
        <NotFoundPanel
          title={t("author.empty")}
          backLabel={t("author.backToDashboard")}
        />
      </DefaultBackground>
    );
  }

  return (
    <DefaultBackground>
      <div className="relative mx-auto max-w-5xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* ── Atmosphere ── gold radial top-right (the honour-corner
            for an author page) + hanko radial bottom-left.
            Pointer-events none so they don't interfere with hover. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-40 -z-10 h-96 w-96 rounded-full bg-gold/10 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -bottom-24 -z-10 h-72 w-72 rounded-full bg-hanko/12 blur-3xl"
        />
        <FloatingDust />
        <CornerOrnaments />

        <Hero displayName={displayName} stats={stats} t={t} />

        {isInitialLoad ? (
          <LoadingPanel t={t} />
        ) : matches.length === 0 ? (
          <NotFoundPanel
            title={t("author.notFound", { name: displayName })}
            backLabel={t("author.backToDashboard")}
          />
        ) : (
          <>
            {stats.topGenres.length > 0 && (
              <GenreSignature topGenres={stats.topGenres} total={stats.seriesCount} t={t} />
            )}

            <PublicationsSection
              matches={matches}
              adult_content_level={adult_content_level}
              onOpen={(m) =>
                navigate("/mangapage", { state: { manga: m, adult_content_level } })
              }
              t={t}
            />
          </>
        )}

        <footer className="mt-12 text-center md:mt-16">
          <Link
            to="/dashboard"
            className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim transition hover:text-washi"
          >
            <span className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            {t("author.backToDashboard")}
          </Link>
        </footer>
      </div>
    </DefaultBackground>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────

function Hero({ displayName, stats, t }) {
  return (
    <header className="relative mb-12 animate-fade-up md:mb-16">
      {/* Top kicker rule with vertical 作家 hanging off the right end —
          the editorial signature row. */}
      <div className="mb-6 flex items-baseline gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
          {t("author.kicker")}
        </span>
        <span className="font-jp text-[11px] tracking-[0.4em] text-hanko/80">
          作家
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent" />
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:gap-12">
        {/* LEFT — author name + headline stats */}
        <div className="min-w-0">
          <h1 className="font-display text-5xl font-light italic leading-[0.95] tracking-tight text-washi md:text-7xl lg:text-[5.5rem]">
            <span className="text-hanko-gradient font-semibold not-italic">
              {displayName}
            </span>
          </h1>

          {/* Brushstroke divider — same SVG path as the Settings page
              chapter dividers. Anchors the masthead block visually. */}
          <Brushstroke className="mt-6 mb-6" />

          {/* Headline stats — three numbers laid out as an editorial
              triad. Each pair is "value · label" stacked vertically so
              the values line up regardless of label length. */}
          <dl className="grid grid-cols-3 gap-4 sm:gap-8">
            <HeadlineStat
              value={stats.seriesCount}
              label={
                stats.seriesCount === 1
                  ? t("author.singleSeries")
                  : t("author.multipleSeriesShort")
              }
              kanji="本"
            />
            <HeadlineStat
              value={stats.totalVolumes}
              label={t("author.volumesUnit")}
              kanji="冊"
            />
            <HeadlineStat
              value={`${stats.completionPct}%`}
              label={t("author.completionLabel")}
              kanji="完"
            />
          </dl>
        </div>

        {/* RIGHT — vertical kanji watermark column. Reads top-to-
            bottom like a real book spine label. Hidden on narrow
            viewports where the headline already pulls focus. */}
        <aside
          aria-hidden="true"
          className="hidden self-start md:block"
          style={{ writingMode: "vertical-rl", textOrientation: "upright" }}
        >
          <p className="flex flex-col items-center gap-3 font-jp text-2xl font-bold leading-tight tracking-[0.4em] text-hanko-bright/40">
            <span className="text-3xl text-hanko-gradient">作</span>
            <span className="text-3xl text-hanko-gradient">家</span>
            <span className="mt-3 text-xs tracking-[0.3em] text-washi-dim">
              一覧
            </span>
          </p>
        </aside>
      </div>
    </header>
  );
}

function HeadlineStat({ value, label, kanji }) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-3 -left-1 font-jp text-3xl font-bold leading-none text-hanko/15 sm:text-4xl"
      >
        {kanji}
      </span>
      <dt className="relative font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
        {label}
      </dt>
      <dd className="relative mt-1 font-display text-3xl font-semibold italic leading-none text-washi tabular-nums sm:text-4xl">
        {value}
      </dd>
    </div>
  );
}

// ─── Genre signature ───────────────────────────────────────────────

function GenreSignature({ topGenres, total, t }) {
  // Compute each genre's share as a fraction of the SUM of top counts.
  // We normalise across what's displayed so the bar always fills to
  // 100% — readable visual weight per genre rather than per-author
  // absolute frequency.
  const sum = topGenres.reduce((acc, g) => acc + g.count, 0);
  const palette = [
    "var(--hanko-bright)",
    "var(--gold)",
    "var(--moegi)",
    "var(--sakura)",
    "var(--ai)",
  ];
  return (
    <section
      aria-label={t("author.genreSignatureAria")}
      className="mb-12 animate-fade-up md:mb-16"
      style={{ animationDelay: "120ms" }}
    >
      <header className="mb-3 flex items-baseline gap-3">
        <span
          aria-hidden="true"
          className="font-jp text-base font-bold leading-none text-hanko-bright"
        >
          題材
        </span>
        <h2 className="font-display text-base font-semibold italic text-washi md:text-lg">
          {t("author.genreSignatureTitle")}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
          · {t("author.genreSignatureHint", { n: total })}
        </span>
      </header>

      {/* The bar — flex of segments. Each segment width is the genre
          share. On hover the segment lifts/brightens. */}
      <div className="overflow-hidden rounded-full border border-border/60 bg-ink-2/30">
        <div className="flex h-3">
          {topGenres.map((g, i) => (
            <span
              key={g.name}
              role="presentation"
              title={`${g.name} · ${g.count}`}
              className="genre-segment relative h-full transition-all"
              style={{
                flexBasis: `${(g.count / sum) * 100}%`,
                background: palette[i % palette.length],
                opacity: 0.85,
              }}
            />
          ))}
        </div>
      </div>

      {/* Legend — wrap of pills, each labelled with the genre name
          and count. Colour swatch matches the segment in the bar. */}
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
        {topGenres.map((g, i) => (
          <li
            key={g.name}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-washi-muted"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ background: palette[i % palette.length] }}
            />
            <span>{g.name}</span>
            <span className="text-washi-dim">·</span>
            <span className="tabular-nums text-washi-dim">{g.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Publications section ──────────────────────────────────────────

function PublicationsSection({ matches, adult_content_level, onOpen, t }) {
  return (
    <section className="mb-8">
      <header className="mb-6 flex items-baseline gap-3 md:mb-8">
        <span
          aria-hidden="true"
          className="font-jp text-2xl font-bold leading-none text-hanko-bright"
        >
          著作
        </span>
        <h2 className="font-display text-xl font-semibold italic text-washi md:text-2xl">
          {t("author.publicationsTitle")}
        </h2>
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent"
        />
        <span className="font-jp text-[10px] tracking-[0.4em] text-washi-dim">
          著作一覧
        </span>
      </header>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6">
        {matches.map((m, i) => (
          <li
            key={m.mal_id ?? m.id}
            className="animate-fade-up"
            style={{ animationDelay: `${200 + i * 70}ms` }}
          >
            <PosterCard
              manga={m}
              index={i}
              adult_content_level={adult_content_level}
              onOpen={() => onOpen(m)}
              t={t}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PosterCard({ manga, index, adult_content_level, onOpen, t }) {
  // Resting tilt alternates per index so the gallery reads as hand-
  // pinned to a corkboard. Hover flattens to 0° and lifts.
  const restTilt = index % 2 === 0 ? "-0.4deg" : "0.4deg";
  const total = manga.volumes ?? 0;
  const owned = manga.volumes_owned ?? 0;
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
  const blurred = hasToBlurImage(manga, adult_content_level);
  const isComplete = total > 0 && owned >= total;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="poster-card group relative block w-full overflow-hidden rounded-xl border border-border/80 bg-ink-1/40 text-left shadow-[0_10px_28px_-14px_rgba(0,0,0,0.7)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-gold/40 hover:shadow-[0_18px_36px_-14px_rgba(201,169,97,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
      style={{
        transform: `rotate(${restTilt})`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "rotate(0deg) translateY(-3px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = `rotate(${restTilt})`;
      }}
      onFocus={(e) => {
        e.currentTarget.style.transform = "rotate(0deg) translateY(-3px)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.transform = `rotate(${restTilt})`;
      }}
      aria-label={t("author.openSeriesAria", { name: manga.name })}
    >
      {/* Cover — strict 2:3 aspect-ratio wrapper so the inner img
          can't blow out. `imgClassName` constrains the actual photo
          so it fills the slot without overflowing. */}
      <div className="relative aspect-[2/3] w-full overflow-hidden">
        {manga.image_url_jpg ? (
          <CoverImage
            src={manga.image_url_jpg}
            alt=""
            blur={blurred}
            paletteSeed={manga.mal_id}
            imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-2 to-ink-3 font-display text-5xl italic text-hanko/30">
            巻
          </div>
        )}

        {/* Top-right corner — completion ribbon. Visible only when
            fully owned, otherwise the small progress fill at the
            bottom carries the signal. */}
        {isComplete && (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 grid h-9 w-9 place-items-center bg-gradient-to-br from-gold to-gold-muted font-jp text-sm font-bold text-ink-0 shadow-md"
            style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%)" }}
          >
            <span className="absolute right-0.5 top-0.5">完</span>
          </span>
        )}

        {/* Bottom gradient that bleeds the cover into the metadata
            strip below — softens the hard line between photograph
            and label. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-1/90 to-transparent"
        />

        {/* Progress meter — sits across the bottom of the cover, fades
            in/out via the bottom gradient. Width drives the eye to
            "how much of this is yours" without a numeric label. */}
        {total > 0 && (
          <div
            aria-hidden="true"
            className="absolute inset-x-2 bottom-2 h-0.5 overflow-hidden rounded-full bg-ink-0/60"
          >
            <span
              className="block h-full bg-gradient-to-r from-hanko-deep via-hanko to-hanko-bright transition-[width]"
              style={{
                width: `${pct}%`,
                boxShadow: pct > 0 ? "0 0 6px var(--hanko-glow)" : "none",
              }}
            />
          </div>
        )}
      </div>

      {/* Metadata strip — title + numeric ratio + optional publisher */}
      <div className="px-3 pt-3 pb-3.5">
        <h3 className="line-clamp-2 font-display text-sm font-semibold italic leading-tight text-washi">
          {manga.name}
        </h3>
        <div className="mt-1.5 flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          <span className="text-washi-dim">
            {owned}/{total || "—"} {t("author.volumesUnit")}
          </span>
          <span
            className={
              isComplete ? "text-gold" : pct > 50 ? "text-hanko-bright" : "text-washi-dim"
            }
          >
            {pct}%
          </span>
        </div>
        {manga.publisher && (
          <p className="mt-1 truncate font-display text-[11px] italic text-washi-muted">
            {manga.publisher}
          </p>
        )}
      </div>
    </button>
  );
}

// ─── Loading panel ─────────────────────────────────────────────────

/**
 * Cold-start placeholder. The cover positions are pre-counted so the
 * grid doesn't reflow once data lands. Skeleton tiles share the
 * `aspect-[2/3]` ratio of the real poster cards so the swap is
 * visually invisible — no layout shift.
 */
function LoadingPanel({ t }) {
  return (
    <section className="mb-8 animate-fade-up" aria-label={t("common.loading")}>
      <div className="mb-6 flex items-baseline gap-3 md:mb-8">
        <span aria-hidden="true" className="font-jp text-2xl font-bold leading-none text-hanko-bright/60">
          著作
        </span>
        <span className="h-4 w-32 rounded bg-ink-2/60" />
        <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-hanko/20 via-border to-transparent" />
      </div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <li
            key={i}
            className="overflow-hidden rounded-xl border border-border/60 bg-ink-1/40 animate-fade-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {/* Pulsing skeleton cover slot — same aspect ratio as the
                real PosterCard cover so the layout doesn't jump when
                the data lands. */}
            <div className="relative aspect-[2/3] w-full overflow-hidden bg-gradient-to-br from-ink-2 to-ink-3">
              <span className="absolute inset-0 animate-pulse bg-ink-2/40" />
            </div>
            <div className="space-y-2 px-3 pt-3 pb-3.5">
              <span className="block h-3.5 w-3/4 rounded bg-ink-2/60" />
              <span className="block h-2.5 w-1/2 rounded bg-ink-2/40" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Not-found panel ───────────────────────────────────────────────

function NotFoundPanel({ title, backLabel }) {
  return (
    <div className="mx-auto max-w-2xl rounded-3xl border border-border bg-ink-1/40 p-12 text-center backdrop-blur md:p-16 animate-fade-up">
      <p
        aria-hidden="true"
        className="tour-stamp-press-target font-jp text-7xl font-bold leading-none text-washi-dim md:text-9xl"
      >
        無
      </p>
      <h1 className="mt-6 font-display text-xl font-light italic leading-tight text-washi md:text-2xl">
        {title}
      </h1>
      <Link
        to="/dashboard"
        className="mt-6 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-hanko transition hover:text-hanko-bright"
      >
        ← {backLabel}
      </Link>
    </div>
  );
}

// ─── Brushstroke divider ───────────────────────────────────────────

function Brushstroke({ className = "" }) {
  return (
    <svg
      viewBox="0 0 1200 8"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`h-1.5 w-full max-w-md ${className}`}
    >
      <defs>
        <linearGradient id="author-brush-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--gold)" stopOpacity="0" />
          <stop offset="14%" stopColor="var(--gold)" stopOpacity="0.7" />
          <stop offset="50%" stopColor="var(--hanko-bright)" stopOpacity="1" />
          <stop offset="86%" stopColor="var(--hanko)" stopOpacity="0.7" />
          <stop offset="100%" stopColor="var(--hanko)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M2,4 Q200,1 400,4 T800,5 T1198,3"
        stroke="url(#author-brush-grad)"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

// ─── Floating particles ────────────────────────────────────────────

const PARTICLES = [
  { x: 12, y: 16, size: 1.5, delay: 0, dur: 16 },
  { x: 28, y: 70, size: 2, delay: 2, dur: 14 },
  { x: 44, y: 32, size: 1, delay: 4, dur: 18 },
  { x: 58, y: 86, size: 2, delay: 1, dur: 13 },
  { x: 72, y: 22, size: 1.5, delay: 5, dur: 15 },
  { x: 88, y: 60, size: 1, delay: 3, dur: 12 },
];

function FloatingDust() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="tour-particle absolute rounded-full bg-gold/35"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Corner ornaments ──────────────────────────────────────────────

function CornerOrnaments() {
  // Two diagonal kanji 作 / 家 in opposite corners — quiet
  // ornamentation that strengthens the "monograph cover page" feel
  // without competing with the masthead. Always hidden on small
  // screens (avoid crowding the hero).
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-2 right-3 hidden -z-10 font-jp text-9xl font-bold leading-none text-hanko/[0.04] md:block"
        style={{ transform: "rotate(8deg)" }}
      >
        作
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-6 left-2 hidden -z-10 font-jp text-9xl font-bold leading-none text-gold/[0.05] md:block"
        style={{ transform: "rotate(-8deg)" }}
      >
        家
      </span>
    </>
  );
}
