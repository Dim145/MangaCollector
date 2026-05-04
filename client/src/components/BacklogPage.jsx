import { useContext, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import CoverImage from "./ui/CoverImage.jsx";
import { useBacklog } from "@/hooks/useBacklog.js";
import { hasToBlurImage } from "@/utils/library.js";
import SettingsContext from "@/SettingsContext.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 積読 Tsundoku · The pile of unread books — laid bare.
 *
 * "Tsundoku" is the Japanese term for the practice of acquiring
 * books and letting them pile up unread. This page treats the user's
 * backlog as a literal pile: each series gets a horizontal "book
 * spine" card, slightly tilted, heat-coded by how cold the series
 * has gone (vibrant moegi for fresh → deep hanko for forgotten).
 *
 * Composition decisions worth knowing:
 *   • Hero kanji 積 lifted from the welcome-tour vocabulary (same
 *     stamp-press keyframe so the typographic family stays cohesive).
 *   • Pile section is the primary surface — KPI tiles take a quiet
 *     supporting role, sitting below the title in a single row.
 *   • Per-card rotation alternates ±0.4° via index modulo. Adds the
 *     hand-arranged feel without crossing into "broken alignment".
 *   • Heat band on the left edge of each spine: width fills as
 *     `staleMonths` grows, hue shifts moegi → gold → hanko-bright →
 *     hanko-deep over a 12-month scale. "Never opened" gets the gold
 *     trim because it's existential, not abandoned.
 *   • Empty state celebrates rather than congratulates — a single 完
 *     stamp + a one-line poem, no gauges or progress charts.
 */
export default function BacklogPage() {
  const navigate = useNavigate();
  const t = useT();
  const { adult_content_level } = useContext(SettingsContext);
  const data = useBacklog();
  // Track the hovered card index so neighbours can react. The eye
  // notices when a stack of books "leans" toward where your hand is
  // about to land — same idea here, just lighter.
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!data) {
    return (
      <DefaultBackground>
        <div className="mx-auto max-w-3xl p-8 text-center text-washi-muted">
          {t("common.loading")}…
        </div>
      </DefaultBackground>
    );
  }

  return (
    <DefaultBackground>
      <div className="relative mx-auto max-w-4xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* ── Atmosphere — gold bloom top-left, hanko bloom bottom-
              right. -z-10 so they sit behind text + cards. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 -top-32 -z-10 h-80 w-80 rounded-full bg-gold/10 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -bottom-24 -z-10 h-72 w-72 rounded-full bg-hanko/12 blur-3xl"
        />
        <FloatingDust />

        <Hero data={data} t={t} />

        {data.totalUnread === 0 ? (
          <EmptyState t={t} />
        ) : (
          <>
            <StatsBand data={data} t={t} />
            <PileHeader t={t} />
            <ul className="space-y-3 md:space-y-4">
              {data.seriesList.map((s, i) => (
                <li
                  key={s.mal_id}
                  // Per-card cascade in. Larger initial offsetX
                  // (32px) than fade-up so each spine reads as
                  // sliding INTO the pile from the right.
                  className="animate-slide-in-right"
                  style={{ animationDelay: `${100 + i * 60}ms` }}
                >
                  <SpineCard
                    series={s}
                    index={i}
                    isHovered={hoverIdx === i}
                    adult_content_level={adult_content_level}
                    onHover={() => setHoverIdx(i)}
                    onLeave={() =>
                      setHoverIdx((cur) => (cur === i ? null : cur))
                    }
                    onOpen={() =>
                      navigate("/mangapage", {
                        state: {
                          manga: {
                            mal_id: s.mal_id,
                            name: s.name,
                            image_url_jpg: s.image_url_jpg,
                          },
                        },
                      })
                    }
                    t={t}
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        <footer className="mt-12 text-center">
          <Link
            to="/dashboard"
            className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim transition hover:text-washi"
          >
            <span className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            {t("backlog.backToDashboard")}
          </Link>
        </footer>
      </div>
    </DefaultBackground>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────

function Hero({ data, t }) {
  return (
    <header className="relative mb-10 animate-fade-up md:mb-14">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8 sm:items-center">
        {/* Big kanji 積 — same stamp-press treatment as the welcome
            tour hero. Adds the bloom ring underneath so the impact
            reads as wet-ink-on-paper. */}
        <div className="relative">
          <span
            aria-hidden="true"
            className="tour-stamp-press-target relative block font-jp font-black leading-none text-[8rem] sm:text-[12rem] text-hanko-gradient"
            style={{ filter: "drop-shadow(0 6px 32px var(--hanko-glow))" }}
          >
            積
          </span>
          <span
            aria-hidden="true"
            className="tour-stamp-press-bloom pointer-events-none absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hanko/40 blur-3xl sm:h-48 sm:w-48"
          />
        </div>

        <div className="pt-2 sm:pt-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
            {t("backlog.kicker")}
          </p>
          <h1 className="mt-3 font-display text-3xl font-light italic leading-tight text-washi md:text-5xl">
            {t("backlog.titlePre")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("backlog.titleAccent")}
            </span>
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-washi-muted md:text-base">
            {data.totalUnread === 0
              ? t("backlog.heroByLineEmpty")
              : t("backlog.heroByline")}
          </p>
        </div>
      </div>
    </header>
  );
}

// ─── KPIs ──────────────────────────────────────────────────────────

function StatsBand({ data, t }) {
  return (
    <section
      aria-label={t("backlog.statsAria")}
      className="mb-10 grid gap-2.5 sm:grid-cols-3 md:mb-14 md:gap-3"
    >
      <Stat
        kanji="冊"
        kanjiLabel="satsu"
        label={t("backlog.statTotalLabel")}
        value={data.totalUnread}
        accent="hanko"
        delay={120}
      />
      <Stat
        kanji="本"
        kanjiLabel="hon"
        label={t("backlog.statSeriesLabel")}
        value={data.seriesCount}
        accent="moegi"
        delay={200}
      />
      <Stat
        kanji="月"
        kanjiLabel="tsuki"
        label={t("backlog.statPaceLabel")}
        value={
          data.monthsToClear == null
            ? "—"
            : data.monthsToClear < 1
              ? "<1"
              : Math.round(data.monthsToClear)
        }
        accent="gold"
        delay={280}
      />
    </section>
  );
}

function Stat({ kanji, kanjiLabel, label, value, accent, delay }) {
  const ringColor = {
    hanko: "border-hanko/30 bg-hanko/5",
    moegi: "border-moegi/30 bg-moegi/5",
    gold: "border-gold/30 bg-gold/5",
  }[accent];
  const kanjiColor = {
    hanko: "text-hanko-bright",
    moegi: "text-moegi",
    gold: "text-gold",
  }[accent];
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border ${ringColor} p-4 backdrop-blur transition hover:scale-[1.01] animate-fade-up`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Watermark kanji — large, rotated, bottom-right corner. The
          card's main content stays left-aligned and the kanji acts
          as a visual hanko on the side. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute -right-2 -bottom-3 font-jp text-7xl font-bold leading-none opacity-15 transition group-hover:opacity-25 ${kanjiColor}`}
        style={{ transform: "rotate(-8deg)" }}
      >
        {kanji}
      </span>

      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
        {label}
      </p>
      <p className="mt-2 font-display text-4xl font-semibold italic leading-none text-washi tabular-nums md:text-5xl">
        {value}
      </p>
      <p
        className={`mt-2 font-mono text-[9px] uppercase tracking-[0.28em] ${kanjiColor}`}
      >
        {kanjiLabel}
      </p>
    </div>
  );
}

// ─── Pile section header ───────────────────────────────────────────

function PileHeader({ t }) {
  return (
    <header className="mb-5 flex items-baseline gap-3 md:mb-7">
      <p
        aria-hidden="true"
        className="font-jp text-2xl font-bold leading-none text-hanko-bright"
      >
        積読
      </p>
      <h2 className="font-display text-xl font-semibold italic text-washi md:text-2xl">
        {t("backlog.pileHeader")}
      </h2>
      <span
        aria-hidden="true"
        className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent"
      />
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
        {t("backlog.pileHint")}
      </span>
    </header>
  );
}

// ─── Spine card ────────────────────────────────────────────────────

function SpineCard({
  series,
  index,
  isHovered,
  adult_content_level,
  onHover,
  onLeave,
  onOpen,
  t,
}) {
  // 棚 · Resting tilt alternates by index parity so the pile reads
  // as hand-stacked. Even rows lean left (-0.4°), odd rows lean
  // right (+0.4°). On hover the card flattens to 0° + lifts — same
  // gesture as picking a book out of a leaning stack.
  const restTilt = index % 2 === 0 ? "-0.4deg" : "0.4deg";

  // Heat — colour intensity grows with stale months. `null` (never
  // read) sits in its own gold-trimmed bucket because it's a
  // different signal from "abandoned".
  const heat = useMemo(() => heatFor(series.staleMonths), [series.staleMonths]);

  // Compute the heat band width — clamped 6%..30% of the card width.
  // Visual weight scales with heat without overpowering the cover.
  const heatWidthPct = useMemo(() => {
    if (series.staleMonths == null) return 12;
    return Math.min(30, 6 + Math.round(series.staleMonths * 2));
  }, [series.staleMonths]);

  const blurred = hasToBlurImage(
    {
      genres: [],
      image_url_jpg: series.image_url_jpg,
      adult_content_level,
    },
    adult_content_level,
  );

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onFocus={onHover}
      onBlur={onLeave}
      className="spine-card group relative flex w-full items-stretch overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-ink-2/80 via-ink-2/55 to-ink-1/70 text-left shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-hanko/50 hover:shadow-[0_18px_36px_-14px_var(--hanko-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hanko/50"
      style={{
        transform: `rotate(${isHovered ? "0deg" : restTilt}) translateY(${isHovered ? "-3px" : "0"}) translateZ(0)`,
      }}
      aria-label={t("backlog.spineAria", { name: series.name ?? "—" })}
    >
      {/* Heat band — coloured edge on the LEFT, width grows with
          stale months. Visual reads as "this book has been sitting
          here longer than that one" without needing labels. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 transition-all duration-300"
        style={{
          width: `${heatWidthPct}%`,
          background: heat.bandGradient,
          opacity: 0.18,
          maskImage:
            "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0) 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0) 100%)",
        }}
      />

      {/* Heat dot — tiny coloured marker that sits flush with the
          left edge, telegraphing the heat at a glance even before
          the user reads the kanji stats column. */}
      <span
        aria-hidden="true"
        className="absolute left-3 top-3 h-1.5 w-1.5 rounded-full"
        style={{
          background: heat.dot,
          boxShadow: `0 0 6px ${heat.glow}`,
        }}
      />

      {/* Cover thumbnail — fixed dimensions so it can't blow out the
          card when the underlying CoverImage uses imgClassName-only
          sizing. The wrapper enforces both axes; CoverImage's inner
          img inherits from the wrapper because of `block h-full
          w-full` baked into its render. */}
      <div className="relative ml-1 my-3 h-24 w-16 shrink-0 overflow-hidden rounded-md border border-border/60 shadow-md sm:h-28 sm:w-[72px]">
        {series.image_url_jpg ? (
          <CoverImage
            src={series.image_url_jpg}
            alt=""
            blur={blurred}
            paletteSeed={series.mal_id}
            imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            className="absolute inset-0"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-2 to-ink-3 font-display text-2xl italic text-hanko/40">
            巻
          </div>
        )}
      </div>

      {/* Content column — title + byline + chips */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 px-4 py-3 sm:px-5">
        <h3 className="line-clamp-2 font-display text-base font-semibold leading-tight text-washi md:text-lg">
          {series.name ?? "—"}
        </h3>

        {/* Status chips — laid horizontally, each carries one numeric
            signal. The coloured chip (right-most) is the heat band's
            verbal companion. */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            kanji="未"
            value={series.unreadCount}
            label={t("backlog.unreadShort")}
            tone="hanko"
          />
          {series.staleMonths != null ? (
            <Chip
              kanji="冷"
              value={Math.round(series.staleMonths)}
              label={t("backlog.staleMonthsShort")}
              tone={heat.tone}
            />
          ) : (
            <Chip
              kanji="新"
              value={null}
              label={t("backlog.neverShort")}
              tone="gold"
            />
          )}
          {series.ageMonths != null && series.ageMonths >= 1 && (
            <Chip
              kanji="着"
              value={Math.round(series.ageMonths)}
              label={t("backlog.ageMonthsShort")}
              tone="muted"
            />
          )}
        </div>
      </div>

      {/* Vertical kanji column — the dramatic touch. Reads top-to-
          bottom right-to-left like a real book spine label. Big
          number = unread count; small kanji = unit. Hidden on
          ultra-narrow viewports where the chips already do the job. */}
      <div
        aria-hidden="true"
        className="hidden shrink-0 items-center justify-center pr-4 pl-2 sm:flex"
        style={{
          writingMode: "vertical-rl",
          textOrientation: "upright",
        }}
      >
        <p className="flex flex-col items-center font-jp text-xs leading-tight tracking-widest text-washi-dim">
          <span className="font-display text-2xl font-bold not-italic leading-none text-hanko-bright">
            {series.unreadCount}
          </span>
          <span className="mt-1.5 text-[10px] uppercase tracking-[0.4em]">
            未読
          </span>
        </p>
      </div>

      {/* Action arrow — sits at the very right edge. Slides in on
          hover (transform). Reads as "pull this book out". */}
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center pr-4 pl-2 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-hanko"
      >
        →
      </span>
    </button>
  );
}

function Chip({ kanji, value, label, tone }) {
  const toneClass = {
    hanko: "border-hanko/30 bg-hanko/8 text-hanko-bright",
    gold: "border-gold/40 bg-gold/8 text-gold",
    moegi: "border-moegi/30 bg-moegi/8 text-moegi",
    sakura: "border-sakura/40 bg-sakura/8 text-sakura",
    muted: "border-border bg-ink-1/30 text-washi-muted",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${toneClass}`}
    >
      <span aria-hidden="true" className="font-jp text-[11px] leading-none">
        {kanji}
      </span>
      {value !== null && (
        <span className="font-display text-[11px] font-semibold not-italic tabular-nums">
          {value}
        </span>
      )}
      <span className="text-[9px] tracking-[0.18em]">{label}</span>
    </span>
  );
}

// ─── Empty state ───────────────────────────────────────────────────

function EmptyState({ t }) {
  return (
    <div className="relative mx-auto max-w-2xl rounded-3xl border border-moegi/30 bg-gradient-to-br from-moegi/8 via-ink-1/60 to-ink-1/30 p-10 text-center backdrop-blur md:p-14 animate-fade-up">
      {/* Decorative kanji watermark in the corner — opposite balance
          to the centre 完 stamp. Adds visual weight without clutter. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-4 -right-4 font-jp text-[10rem] font-bold leading-none text-moegi/8"
        style={{ transform: "rotate(-6deg)" }}
      >
        無
      </span>

      <p className="relative font-mono text-[10px] uppercase tracking-[0.32em] text-moegi">
        {t("backlog.emptyKicker")}
      </p>
      <p
        aria-hidden="true"
        className="tour-stamp-press-target relative mt-4 font-jp text-7xl font-bold leading-none text-moegi md:text-9xl"
        style={{ filter: "drop-shadow(0 4px 24px rgba(163,201,97,0.4))" }}
      >
        完
      </p>
      <h2 className="relative mt-5 font-display text-2xl font-semibold italic leading-tight text-washi md:text-3xl">
        {t("backlog.emptyTitle")}
      </h2>
      <p className="relative mx-auto mt-3 max-w-md text-sm leading-relaxed text-washi-muted">
        {t("backlog.emptyBody")}
      </p>
    </div>
  );
}

// ─── Atmospheric particles ─────────────────────────────────────────

const PARTICLES = [
  { x: 8, y: 18, size: 1.5, delay: 0, dur: 16 },
  { x: 22, y: 64, size: 2, delay: 3, dur: 13 },
  { x: 34, y: 32, size: 1, delay: 5, dur: 17 },
  { x: 48, y: 80, size: 2.5, delay: 1, dur: 14 },
  { x: 62, y: 24, size: 1.5, delay: 4, dur: 15 },
  { x: 74, y: 56, size: 1, delay: 6, dur: 12 },
  { x: 86, y: 36, size: 2, delay: 2, dur: 18 },
  { x: 92, y: 72, size: 1.5, delay: 5.5, dur: 14 },
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
          className="tour-particle absolute rounded-full bg-gold/30"
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

// ─── Heat helper ───────────────────────────────────────────────────

/**
 * Map "stale months" → visual heat. The bands are intentionally
 * coarse: a backlog audit isn't a precise instrument, it's a
 * temperature read. `null` (never read) gets its own gold trim
 * because it's existential rather than abandoned.
 */
function heatFor(staleMonths) {
  if (staleMonths == null) {
    return {
      tone: "gold",
      bandGradient:
        "linear-gradient(135deg, var(--gold) 0%, var(--gold-muted) 100%)",
      dot: "var(--gold)",
      glow: "rgba(201,169,97,0.6)",
    };
  }
  if (staleMonths < 1) {
    return {
      tone: "moegi",
      bandGradient:
        "linear-gradient(135deg, var(--moegi) 0%, var(--moegi-muted) 100%)",
      dot: "var(--moegi)",
      glow: "rgba(163,201,97,0.6)",
    };
  }
  if (staleMonths < 3) {
    return {
      tone: "gold",
      bandGradient:
        "linear-gradient(135deg, var(--gold) 0%, var(--gold-muted) 100%)",
      dot: "var(--gold)",
      glow: "rgba(201,169,97,0.6)",
    };
  }
  if (staleMonths < 6) {
    return {
      tone: "sakura",
      bandGradient:
        "linear-gradient(135deg, var(--sakura) 0%, var(--hanko-bright) 100%)",
      dot: "var(--sakura)",
      glow: "rgba(247,170,200,0.6)",
    };
  }
  return {
    tone: "hanko",
    bandGradient:
      "linear-gradient(135deg, var(--hanko-bright) 0%, var(--hanko-deep) 100%)",
    dot: "var(--hanko-bright)",
    glow: "var(--hanko-glow)",
  };
}
