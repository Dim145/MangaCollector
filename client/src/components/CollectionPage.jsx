import { useContext, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import CoverImage from "./ui/CoverImage.jsx";
import SettingsContext from "@/SettingsContext.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useCollection } from "@/hooks/useCollection.js";
import { hasToBlurImage } from "@/utils/library.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 出版 Shuppan / 版 Han · Per-publisher / per-edition filtered
 * library view.
 *
 * Two routes share this component:
 *   - `/publisher/:name`  → kind="publisher" — `出版`
 *   - `/edition/:name`    → kind="edition"   — `版`
 *
 * Aesthetic — a fac-similé of a 19th-century imprint catalogue.
 * The masthead is the publisher / edition name in italic display
 * (Fraunces), with a vertical kanji `出版` / `版` watermark down
 * the page edge. The body is a stats triad + a genre signature
 * (publishers only — editions are format-defined, not content)
 * + a poster grid ("body of work under this imprint"). The
 * differentiator from AuthorPage is intentionally subtle: same
 * vocabulary so a user who knows one knows the other, only the
 * subject (the imprint instead of the mangaka) and the kanji
 * shift.
 *
 * Pure client-side: filters the library cache by the column
 * matching `kind`, no server endpoint needed (publisher and
 * edition are local string columns on user_libraries).
 */
export default function CollectionPage({ kind = "publisher" }) {
  const params = useParams();
  const navigate = useNavigate();
  const t = useT();
  const { adult_content_level } = useContext(SettingsContext);
  const { data: library, isInitialLoad } = useLibrary();

  const rawName = params.name;
  const targetName = useMemo(() => {
    try {
      return decodeURIComponent(rawName ?? "").trim();
    } catch {
      return rawName ?? "";
    }
  }, [rawName]);

  const { matches, displayName, stats } = useCollection({
    kind,
    name: targetName,
    library,
  });

  // Per-kind labels picked from the i18n tree. Avoids a sprawl of
  // ternary expressions in the JSX below; localisation stays a
  // single source.
  const labels = labelsFor(kind, t);

  if (!targetName) {
    return (
      <DefaultBackground>
        <NotFoundPanel
          title={t("collection.empty")}
          backLabel={t("collection.backToDashboard")}
        />
      </DefaultBackground>
    );
  }

  return (
    <DefaultBackground>
      <div className="relative mx-auto max-w-5xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* Atmosphere — diagonal pair: moegi (publishing trade
            inks) top-right, gold (binding leaf) bottom-left.
            Distinct from AuthorPage's hanko/gold to mark the
            different surface without breaking the palette. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-40 -z-10 h-96 w-96 rounded-full bg-moegi/10 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -bottom-24 -z-10 h-72 w-72 rounded-full bg-gold/10 blur-3xl"
        />
        <CornerWatermark kanji={labels.watermarkLeft} accent="hanko" />
        <CornerWatermark
          kanji={labels.watermarkRight}
          accent="gold"
          right
        />

        <Hero
          kind={kind}
          labels={labels}
          displayName={displayName}
          stats={stats}
          t={t}
        />

        {isInitialLoad ? (
          <LoadingPanel t={t} />
        ) : matches.length === 0 ? (
          <NotFoundPanel
            title={t("collection.notFound", {
              name: displayName,
              kind: labels.kindNoun,
            })}
            backLabel={t("collection.backToDashboard")}
          />
        ) : (
          <>
            {/* Genre signature — only meaningful for publishers
                (editions span genres by definition). The shape
                mirrors AuthorPage's GenreSignature so users who
                read an author's fingerprint there read this one
                without re-learning. */}
            {kind === "publisher" && stats.topGenres.length > 0 && (
              <GenreSignature
                topGenres={stats.topGenres}
                total={stats.seriesCount}
                t={t}
              />
            )}

            {/* For edition pages, show a "publishers represented"
                strip instead — which imprints publish this edition
                variant in your library. More useful for editions
                because "Édition deluxe" can come from Glénat AND
                Pika AND Kana, and the user often wants to know
                which publishers have invested in that format. */}
            {kind === "edition" && (
              <PublishersStrip matches={matches} t={t} />
            )}

            <PublicationsSection
              matches={matches}
              adult_content_level={adult_content_level}
              onOpen={(m) =>
                navigate("/mangapage", {
                  state: { manga: m, adult_content_level },
                })
              }
              labels={labels}
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
            {t("collection.backToDashboard")}
          </Link>
        </footer>
      </div>
    </DefaultBackground>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────

function Hero({ kind, labels, displayName, stats, t }) {
  return (
    <header className="relative mb-12 animate-fade-up md:mb-16">
      {/* Top kicker rule — the imprint catalog signature row.
          Format: kicker + jp signature + horizontal hairline +
          nothing-else (imprints don't carry photo/MAL/edit
          actions, so no chips here). */}
      <div className="mb-6 flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
          {labels.kicker}
        </span>
        <span className="font-jp text-[11px] tracking-[0.4em] text-hanko/80">
          {labels.kanji}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
          {labels.kindNoun}
        </span>
      </div>

      {/* Main row: large name + stats triad on the right */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-12">
        <div className="min-w-0">
          <h1
            data-ink-trail="true"
            className="font-display text-5xl font-light italic leading-[0.95] tracking-tight text-washi md:text-6xl lg:text-7xl"
          >
            <span className="text-hanko-gradient font-semibold not-italic">
              {displayName}
            </span>
          </h1>
          {/* Brushstroke + subtitle line that explains what we're
              looking at (kind-aware) */}
          <Brushstroke className="mt-5 mb-4" />
          <p className="max-w-md font-display text-lg font-light italic leading-snug text-washi-muted md:text-xl">
            {labels.subtitle}
          </p>
        </div>

        {/* Headline stats — three numbers laid as an editorial
            triad. Identical shape to AuthorPage so the page reads
            as a sister surface. */}
        <dl className="grid grid-cols-3 gap-4 sm:gap-8 md:max-w-xs">
          <HeadlineStat
            value={stats.seriesCount}
            label={
              stats.seriesCount === 1
                ? t("collection.singleSeries")
                : t("collection.multipleSeriesShort")
            }
            kanji="本"
          />
          <HeadlineStat
            value={stats.totalVolumes}
            label={t("collection.volumesUnit")}
            kanji="冊"
          />
          <HeadlineStat
            value={`${stats.completionPct}%`}
            label={t("collection.completionLabel")}
            kanji="完"
          />
        </dl>
      </div>

      {/* Sibling-surface hint — when looking at a publisher,
          surface a tiny chip suggesting the user could also slice
          by edition (and vice versa). Quiet, in case the user
          doesn't yet know the other surface exists. */}
      <SiblingHint kind={kind} t={t} />
    </header>
  );
}

function SiblingHint({ kind, t }) {
  return (
    <p
      className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-border bg-ink-1/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim"
      style={{ animationDelay: "150ms" }}
    >
      <span aria-hidden="true" className="font-jp text-[11px] not-italic">
        {kind === "publisher" ? "版" : "出"}
      </span>
      {kind === "publisher"
        ? t("collection.hintTryEdition")
        : t("collection.hintTryPublisher")}
    </p>
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

// ─── Genre signature (publishers only) ─────────────────────────────

function GenreSignature({ topGenres, total, t }) {
  const sum = topGenres.reduce((acc, g) => acc + g.count, 0);
  const palette = [
    "var(--hanko-bright)",
    "var(--gold)",
    "var(--moegi)",
    "var(--sakura)",
    "var(--ai)",
    "var(--washi)",
  ];
  return (
    <section
      aria-label={t("collection.genreSignatureAria")}
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
          {t("collection.genreSignatureTitle")}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
          · {t("collection.genreSignatureHint", { n: total })}
        </span>
      </header>
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

// ─── Publishers strip (editions only) ──────────────────────────────

function PublishersStrip({ matches, t }) {
  const counts = useMemo(() => {
    const m = new Map();
    for (const row of matches) {
      const p = row.publisher?.trim();
      if (!p) continue;
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8);
  }, [matches]);
  if (counts.length === 0) return null;
  return (
    <section
      aria-label={t("collection.publishersStripAria")}
      className="mb-12 animate-fade-up md:mb-16"
      style={{ animationDelay: "120ms" }}
    >
      <header className="mb-3 flex items-baseline gap-3">
        <span
          aria-hidden="true"
          className="font-jp text-base font-bold leading-none text-hanko-bright"
        >
          出版
        </span>
        <h2 className="font-display text-base font-semibold italic text-washi md:text-lg">
          {t("collection.publishersStripTitle")}
        </h2>
      </header>
      <ul className="flex flex-wrap gap-2">
        {counts.map(([name, n]) => (
          <li key={name}>
            <Link
              to={`/publisher/${encodeURIComponent(name)}`}
              className="group inline-flex items-center gap-1.5 rounded-full border border-moegi/40 bg-moegi/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-moegi transition hover:border-moegi/70 hover:bg-moegi/10 hover:text-moegi-bright"
            >
              <span className="font-display text-[12px] italic not-italic">
                {name}
              </span>
              <span className="text-washi-dim">·</span>
              <span className="tabular-nums text-washi-dim">{n}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Publications grid ────────────────────────────────────────────

function PublicationsSection({
  matches,
  adult_content_level,
  onOpen,
  labels,
  t,
}) {
  return (
    <section className="mb-8">
      <header className="mb-6 flex items-baseline gap-3 md:mb-8">
        <span
          aria-hidden="true"
          className="font-jp text-2xl font-bold leading-none text-hanko-bright"
        >
          {labels.corpusKanji}
        </span>
        <h2 className="font-display text-xl font-semibold italic text-washi md:text-2xl">
          {labels.corpusTitle}
        </h2>
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent"
        />
        <span className="font-jp text-[10px] tracking-[0.4em] text-washi-dim">
          {labels.corpusFooterKanji}
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
      className="poster-card group relative block w-full overflow-hidden rounded-xl border border-border/80 bg-ink-1/40 text-left shadow-[0_10px_28px_-14px_rgba(0,0,0,0.7)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-moegi/40 hover:shadow-[0_18px_36px_-14px_rgba(163,201,97,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moegi/40"
      style={{ transform: `rotate(${restTilt})` }}
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
      aria-label={t("collection.openSeriesAria", { name: manga.name })}
    >
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

        {/* Top-right corner — completion ribbon */}
        {isComplete && (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 grid h-9 w-9 place-items-center bg-gradient-to-br from-gold to-gold-muted font-jp text-sm font-bold text-ink-0 shadow-md"
            style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%)" }}
          >
            <span className="absolute right-0.5 top-0.5">完</span>
          </span>
        )}

        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-1/90 to-transparent"
        />

        {total > 0 && (
          <div
            aria-hidden="true"
            className="absolute inset-x-2 bottom-2 h-0.5 overflow-hidden rounded-full bg-ink-0/60"
          >
            <span
              className="block h-full bg-gradient-to-r from-moegi/70 via-moegi to-moegi-bright transition-[width]"
              style={{
                width: `${pct}%`,
                boxShadow:
                  pct > 0 ? "0 0 6px rgba(163,201,97,0.35)" : "none",
              }}
            />
          </div>
        )}
      </div>

      <div className="px-3 pt-3 pb-3.5">
        <h3 className="line-clamp-2 font-display text-sm font-semibold italic leading-tight text-washi">
          {manga.name}
        </h3>
        <div className="mt-1.5 flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          <span className="text-washi-dim">
            {owned}/{total || "—"} {t("collection.volumesUnit")}
          </span>
          <span
            className={
              isComplete
                ? "text-gold"
                : pct > 50
                  ? "text-moegi"
                  : "text-washi-dim"
            }
          >
            {pct}%
          </span>
        </div>
        {/* Sibling field — when looking at a publisher card, show
            the edition (helps differentiate "Glénat / Standard"
            from "Glénat / Deluxe"). When looking at an edition,
            show the publisher. */}
        {manga.publisher && manga.edition && (
          <p className="mt-1 truncate font-display text-[11px] italic text-washi-muted">
            {manga.edition}
          </p>
        )}
      </div>
    </button>
  );
}

// ─── States ────────────────────────────────────────────────────────

function NotFoundPanel({ title, backLabel }) {
  return (
    <div className="mx-auto max-w-2xl rounded-3xl border border-border bg-ink-1/40 p-12 text-center backdrop-blur md:p-16 animate-fade-up">
      <p
        aria-hidden="true"
        className="font-jp text-7xl font-bold leading-none text-washi-dim md:text-9xl"
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

function LoadingPanel({ t }) {
  return (
    <ul
      aria-label={t("common.loading")}
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <li
          key={i}
          className="overflow-hidden rounded-xl border border-border/60 bg-ink-1/40 animate-fade-up"
          style={{ animationDelay: `${i * 60}ms` }}
        >
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
  );
}

// ─── Decorative ────────────────────────────────────────────────────

function CornerWatermark({ kanji, accent = "hanko", right = false }) {
  // 100 chars wide kanji watermark in the page corner. Different
  // from AuthorPage's so the two surfaces are visually distinct
  // even when seen back-to-back.
  const colour =
    accent === "gold" ? "text-gold/[0.05]" : "text-hanko/[0.04]";
  const positional = right
    ? "-bottom-6 left-2"
    : "-top-2 right-3";
  const rotate = right ? "rotate(-8deg)" : "rotate(8deg)";
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute hidden -z-10 font-jp text-9xl font-bold leading-none md:block ${colour} ${positional}`}
      style={{ transform: rotate }}
    >
      {kanji}
    </span>
  );
}

function Brushstroke({ className = "" }) {
  return (
    <svg
      viewBox="0 0 1200 8"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`h-1.5 w-full max-w-md ${className}`}
    >
      <defs>
        <linearGradient id="collection-brush" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--moegi)" stopOpacity="0" />
          <stop offset="14%" stopColor="var(--moegi)" stopOpacity="0.5" />
          <stop offset="50%" stopColor="var(--gold)" stopOpacity="0.85" />
          <stop offset="86%" stopColor="var(--hanko)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--hanko)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M2,4 Q200,1 400,4 T800,5 T1198,3"
        stroke="url(#collection-brush)"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Per-kind localisation packet. */
function labelsFor(kind, t) {
  if (kind === "edition") {
    return {
      kicker: t("collection.kickerEdition"),
      kanji: "版",
      kindNoun: t("collection.kindEdition"),
      subtitle: t("collection.subtitleEdition"),
      watermarkLeft: "版",
      watermarkRight: "装",
      corpusKanji: "刊",
      corpusFooterKanji: "刊行一覧",
      corpusTitle: t("collection.corpusTitleEdition"),
    };
  }
  return {
    kicker: t("collection.kickerPublisher"),
    kanji: "出版",
    kindNoun: t("collection.kindPublisher"),
    subtitle: t("collection.subtitlePublisher"),
    watermarkLeft: "出",
    watermarkRight: "版",
    corpusKanji: "刊",
    corpusFooterKanji: "刊行一覧",
    corpusTitle: t("collection.corpusTitlePublisher"),
  };
}
