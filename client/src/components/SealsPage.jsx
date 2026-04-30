import { useEffect, useMemo, useRef, useState } from "react";
import DefaultBackground from "./DefaultBackground";
import Seal from "./ui/Seal.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { useSeals } from "@/hooks/useSeals.js";
import { SEALS_BY_CATEGORY, SEAL_CATALOG, TIERS } from "@/lib/sealsCatalog.js";
import { sounds } from "@/lib/sounds.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 印鑑帳 — Carnet de sceaux (festival edition).
 *
 * The page is a celebration, not a status table. It reads more like a
 * matsuri tournament board than an admin grid:
 *
 *   • A drifting flock of sakura petals across the whole canvas — pure
 *     CSS, six instances at staggered delays so the rhythm never reads
 *     as a marquee. Off when the OS asks for reduced motion.
 *
 *   • A hero band with a giant gold 印 watermark drifting in the
 *     background, a HUGE earned-count display, and (top-right) a
 *     circular RANK BADGE whose halo recolours per the user's highest
 *     earned tier — ink-black at start, hanko-red, moegi-green,
 *     gold, then black-with-gold-rays at legendary.
 *
 *   • A row of 5 vertical TIER LANTERNS replacing the legacy legend.
 *     Each lantern stacks a kanji header, count, and gradient bar in
 *     its tier colour — the eye reads the rank ladder at a glance.
 *
 *   • A "QUEST" panel pointing at the closest unearned seal. Bigger
 *     than the chip-style hint it replaces; reads like a JRPG quest
 *     prompt.
 *
 *   • Each category section gets a "CHAPITRE N" eyebrow + brushstroke
 *     divider + a kanji medallion. When fully earned, the section
 *     wears a gold "CHAPITRE COMPLET" banner with a sweeping shimmer
 *     and a sparkle satellite — a real reward, not a quiet checkmark.
 *
 * The ceremony loop (scroll-into-view + dim overlay + spotlight per
 * newly_granted seal) is preserved verbatim — it remains the page's
 * primary celebration moment for the freshly-earned stamps.
 */
export default function SealsPage() {
  const t = useT();
  const { data, isLoading } = useSeals();

  const earnedMap = useMemo(() => {
    const m = new Map();
    (data?.earned ?? []).forEach((e) => m.set(e.code, e.earned_at));
    return m;
  }, [data]);
  const newlySet = useMemo(
    () => new Set(data?.newly_granted ?? []),
    [data?.newly_granted],
  );

  // 儀式 · In-grid ceremony loop — orchestrates a sequential
  // spotlight-and-stamp routine across every freshly-earned seal.
  // Logic preserved verbatim from the previous revision; see the
  // detailed inline comments below for each step.
  const consumedRef = useRef(null);
  const [ceremonyIndex, setCeremonyIndex] = useState(-1);
  const skipRef = useRef(null);
  const newlyList = useMemo(
    () =>
      Array.isArray(data?.newly_granted) ? data.newly_granted : [],
    [data?.newly_granted],
  );
  const currentCode = ceremonyIndex >= 0 ? newlyList[ceremonyIndex] : null;

  useEffect(() => {
    if (newlyList.length === 0) return;
    if (consumedRef.current === newlyList) return;
    consumedRef.current = newlyList;

    let cancelled = false;
    const interruptible = (ms) =>
      new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          skipRef.current = null;
          resolve();
        }, ms);
        skipRef.current = () => {
          window.clearTimeout(timer);
          skipRef.current = null;
          resolve();
        };
      });

    const findSealTarget = async (code) => {
      const deadline = Date.now() + 600;
      while (Date.now() < deadline) {
        const el = document.querySelector(`[data-seal-code="${code}"]`);
        if (el) return el;
        await new Promise((r) => requestAnimationFrame(r));
      }
      return document.querySelector(`[data-seal-code="${code}"]`);
    };

    (async () => {
      for (let i = 0; i < newlyList.length; i++) {
        if (cancelled) return;
        const code = newlyList[i];
        const target = await findSealTarget(code);
        if (cancelled) return;
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        await interruptible(700);
        if (cancelled) return;
        setCeremonyIndex(i);
        try {
          navigator.vibrate?.([18, 50, 80]);
        } catch {
          /* haptic unsupported — silent */
        }
        // 印 · Ceremonial chime — tier drives note count + bass so a
        // shikkoku unlock feels meaningfully heavier than a sumi.
        // Fired in the same beat as the haptic so the audio + buzz
        // land with the spotlight stamp on screen.
        const sealMeta = SEAL_CATALOG.find((s) => s.code === code);
        sounds.seal(sealMeta?.tier ?? 1);
        await interruptible(2400);
      }
      if (!cancelled) setCeremonyIndex(-1);
    })();

    return () => {
      cancelled = true;
      if (skipRef.current) skipRef.current();
      setCeremonyIndex(-1);
    };
  }, [newlyList]);

  const handleOverlayClick = () => skipRef.current?.();

  const earnedCount = earnedMap.size;
  const totalCount = SEAL_CATALOG.length;
  const percent = Math.round((earnedCount / totalCount) * 100);

  // 階 · Per-tier breakdown — feeds the lantern row.
  const tierStats = useMemo(() => {
    const stats = {};
    Object.keys(TIERS).forEach((k) => {
      const tier = parseInt(k, 10);
      const seals = SEAL_CATALOG.filter((s) => s.tier === tier);
      const earned = seals.filter((s) => earnedMap.has(s.code)).length;
      stats[tier] = { earned, total: seals.length };
    });
    return stats;
  }, [earnedMap]);

  // 階級 · Highest tier the user has reached — feeds the rank badge.
  // 0 means no seals yet (the badge then renders an "Initiate" state
  // rather than picking the lowest tier).
  const highestTier = useMemo(() => {
    let max = 0;
    SEAL_CATALOG.forEach((s) => {
      if (earnedMap.has(s.code) && s.tier > max) max = s.tier;
    });
    return max;
  }, [earnedMap]);

  // 近 · Closest unearned seal — feeds the QUEST panel.
  const nextSeal = useMemo(() => {
    return (
      [...SEAL_CATALOG]
        .filter((s) => !earnedMap.has(s.code))
        .sort((a, b) => a.tier - b.tier)[0] ?? null
    );
  }, [earnedMap]);

  return (
    <DefaultBackground>
      {/* Ceremony dimmer — same behaviour as before. */}
      {ceremonyIndex >= 0 && (
        <button
          type="button"
          aria-label={t("seals.ceremonySkip")}
          onClick={handleOverlayClick}
          className="fixed inset-0 z-40 cursor-pointer animate-fade-in bg-ink-0/40 focus:outline-none"
        />
      )}

      {/* Ambient sakura petals — pure CSS. Hidden on mobile because the
          drift looks busy on smaller viewports; this is a desktop
          delight. */}
      <FloatingPetals />

      <div className="relative mx-auto max-w-6xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* ───── HERO ───── */}
        <header className="relative mb-14 animate-fade-up">
          {/* watermark + atmospheric blooms in their own clip-layer */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl"
          >
            <span
              className="absolute -top-4 right-2 select-none font-jp text-[26rem] font-bold leading-none text-gold/[0.07]"
              style={{
                animation: "seal-watermark-drift 14s ease-in-out infinite",
              }}
            >
              印
            </span>
            <div className="absolute -top-32 -left-32 h-72 w-72 rounded-full bg-hanko/10 blur-3xl" />
            <div className="absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-gold/10 blur-3xl" />
          </div>

          {/* Two-column hero on desktop, stacked on mobile. The rank
              badge sits to the right where the eye lands after scanning
              the title. */}
          <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            {/* LEFT: eyebrow / title / hero-stat / progress / lanterns */}
            <div className="min-w-0">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs uppercase tracking-[0.3em] text-hanko">
                  {t("seals.eyebrow")}
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent" />
                <span className="hidden font-jp text-[10px] tracking-[0.3em] text-washi-dim sm:inline">
                  印鑑帳
                </span>
              </div>

              <h1 className="mt-3 font-display text-4xl font-light italic leading-[0.95] tracking-tight text-washi md:text-6xl">
                {t("seals.yourTitle")}{" "}
                <span className="text-hanko-gradient font-semibold not-italic">
                  {t("seals.titleAccent")}
                </span>
              </h1>

              <p className="mt-4 max-w-xl font-sans text-sm leading-relaxed text-washi-muted">
                {t("seals.subtitle")}
              </p>

              {/* HERO STAT — the count gets the spotlight, not a ratio. */}
              <div className="mt-7 flex items-baseline gap-4">
                <span
                  className="font-display text-7xl font-semibold italic leading-none tracking-tight text-washi md:text-8xl"
                  style={{ textShadow: "0 4px 28px rgba(220,38,38,0.25)" }}
                >
                  <span className="text-hanko-gradient">{earnedCount}</span>
                </span>
                <div className="flex flex-col gap-1 pb-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim">
                    / {totalCount}
                  </span>
                  <span className="font-display italic text-base text-washi-muted md:text-lg">
                    {t("seals.statSubtitle")}
                  </span>
                </div>
              </div>

              {/* OVERALL PROGRESS RAIL */}
              <div className="mt-5">
                <div className="seal-progress-rail relative h-2 w-full overflow-hidden rounded-full bg-ink-2/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-hanko-deep via-hanko to-hanko-bright transition-all duration-1000 ease-out"
                    style={{
                      width: `${percent}%`,
                      boxShadow: percent > 0 ? "0 0 12px var(--hanko-glow)" : "none",
                    }}
                  />
                  {percent > 0 && percent < 100 && (
                    <span
                      aria-hidden="true"
                      className="seal-progress-marker absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hanko shadow-[0_0_14px_var(--hanko-glow)]"
                      style={{ left: `${percent}%` }}
                    />
                  )}
                </div>
                <div className="mt-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
                  <span>{t("seals.progressLabel")}</span>
                  <span className="text-washi-muted tabular-nums">{percent}%</span>
                </div>
              </div>

              {/* TIER LANTERNS — 5 vertical bars, one per ink rank */}
              <TierLanterns tierStats={tierStats} highestTier={highestTier} t={t} />
            </div>

            {/* RIGHT: rank badge — only on lg+, where there's horizontal
                room. On smaller screens the badge would crowd the title. */}
            <div className="hidden lg:block">
              <RankBadge tier={highestTier} t={t} />
            </div>
          </div>
        </header>

        {/* ───── NEWLY-GRANTED BANNER ───── */}
        {newlySet.size > 0 && (
          <NewlyGrantedBanner count={newlySet.size} t={t} />
        )}

        {/* ───── NEXT QUEST CARD ───── */}
        {!isLoading && nextSeal && newlySet.size === 0 && (
          <NextQuestCard seal={nextSeal} t={t} />
        )}

        {/* ───── LOADING ───── */}
        {isLoading && <SealsPageSkeleton />}

        {/* ───── SECTIONS ───── */}
        {!isLoading &&
          SEALS_BY_CATEGORY.map((category, ci) => {
            const categoryEarned = category.seals.filter((s) =>
              earnedMap.has(s.code),
            ).length;
            const categoryComplete = categoryEarned === category.seals.length;
            return (
              <CategorySection
                key={category.code}
                category={category}
                chapterNumber={ci + 1}
                animationDelay={120 + ci * 50}
                categoryEarned={categoryEarned}
                categoryComplete={categoryComplete}
                earnedMap={earnedMap}
                newlySet={newlySet}
                currentCode={currentCode}
                ceremonyManaged={newlyList.length > 0}
                t={t}
              />
            );
          })}
      </div>
    </DefaultBackground>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SUB-COMPONENTS — split out so the main render stays readable.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Six sakura petals drifting from above the viewport down past the
 * fold. Each one gets a hand-tuned position / duration / delay so the
 * flock feels organic rather than synchronised. Hidden via CSS when
 * the user prefers reduced motion (handled in index.css).
 */
function FloatingPetals() {
  // Hand-tuned constants — picked individually so the petals drift at
  // different cadences instead of marching in lockstep. Mobile gets
  // fewer petals (the smaller canvas would otherwise feel cluttered).
  const petals = [
    { left: "8%",  size: 14, dur: 22, delay: 0,    drift: 60,  rot: 320, opacity: 0.55 },
    { left: "22%", size: 12, dur: 28, delay: 6,    drift: -40, rot: -280, opacity: 0.45 },
    { left: "38%", size: 18, dur: 19, delay: 11,   drift: 90,  rot: 360, opacity: 0.5 },
    { left: "55%", size: 11, dur: 25, delay: 3,    drift: -70, rot: -340, opacity: 0.4 },
    { left: "72%", size: 16, dur: 21, delay: 14,   drift: 50,  rot: 400, opacity: 0.55 },
    { left: "88%", size: 13, dur: 26, delay: 8,    drift: -30, rot: -360, opacity: 0.45 },
  ];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-[5] hidden overflow-hidden md:block"
    >
      {petals.map((p, i) => (
        <span
          key={i}
          className="seal-petal"
          style={{
            left: p.left,
            width: `${p.size}px`,
            height: `${p.size}px`,
            "--drift-x": `${p.drift}px`,
            "--drift-rot": `${p.rot}deg`,
            "--petal-duration": `${p.dur}s`,
            "--petal-delay": `${p.delay}s`,
            "--petal-opacity": p.opacity,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The hero rank badge — a circular medallion whose halo recolours per
 * the user's highest earned tier. At tier 0 (no seals yet) the badge
 * shows an "Initié" state with sumi-grey rays; at tier 5 it gleams
 * with gold rays on a near-black core (legendary lacquer).
 */
function RankBadge({ tier, t }) {
  const tierMeta = tier > 0 ? TIERS[tier] : { name: "sumi", label: "—" };
  // The tier i18n string is "<kanji> · <translated name>" (e.g.
  // "萌葱 · Jade"). Split on the middle dot:
  //   [0] → the kanji (decorative)
  //   [1] → the translated name (readable)
  // The chip below the medallion uses the readable half so visitors
  // who don't read JP know what their rank actually means; the
  // medallion itself keeps the kanji as its icon (it's the visual
  // signature) but exposes the full string via `title=` on hover for
  // anyone who's curious about the JP reading.
  const tierFullLabel = tier > 0 ? t(`seals.tiers.${tierMeta.name}`) : null;
  const rankName =
    tier > 0
      ? tierFullLabel.split("·")[1]?.trim() ?? tierMeta.label
      : t("seals.rankNone");
  return (
    <div
      className="seal-rank relative flex h-44 w-44 items-center justify-center"
      data-tier={tier}
    >
      {/* Slow-rotating sun-rays halo (large, blurred) */}
      <span aria-hidden="true" className="seal-rank-rays" />
      {/* Faster, sharper inner rays for a layered halo */}
      <span aria-hidden="true" className="seal-rank-rays-fast" />

      {/* The medallion itself */}
      <div
        title={tierFullLabel ?? undefined}
        className={`relative grid h-32 w-32 place-items-center rounded-full border-2 backdrop-blur transition-all ${
          tier === 0
            ? "border-washi-dim/30 bg-ink-1/80"
            : tier === 1
              ? "border-washi-muted/40 bg-ink-1/85 shadow-[0_0_30px_rgba(0,0,0,0.4)]"
              : tier === 2
                ? "border-hanko/60 bg-gradient-to-br from-hanko/20 to-ink-1/90 shadow-[0_0_28px_rgba(220,38,38,0.45)]"
                : tier === 3
                  ? "border-moegi/60 bg-gradient-to-br from-moegi/15 to-ink-1/90 shadow-[0_0_28px_rgba(167,209,114,0.45)]"
                  : tier === 4
                    ? "border-gold/70 bg-gradient-to-br from-gold/15 to-ink-1/90 shadow-[0_0_30px_rgba(212,160,57,0.5)]"
                    : "border-gold/80 bg-gradient-to-br from-ink-0 via-ink-1 to-ink-0 shadow-[0_0_36px_rgba(212,160,57,0.55)]"
        }`}
      >
        {tier > 0 ? (
          <span
            className={`font-jp font-bold leading-none ${
              tier === 5 ? "text-gold" : "text-washi"
            }`}
            style={{ fontSize: "3.2rem" }}
          >
            {tierMeta.label}
          </span>
        ) : (
          // Empty rank: a soft dashed circle and a quiet kanji
          <span
            className="font-jp text-3xl font-bold leading-none text-washi-dim"
            style={{ opacity: 0.5 }}
          >
            初
          </span>
        )}
      </div>

      {/* Floating label below the medallion */}
      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-ink-1/90 px-3 py-1 backdrop-blur">
        <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-washi-dim">
          {t("seals.rankLabel")}
        </p>
        <p className="text-center font-display text-xs italic text-washi">
          {rankName}
        </p>
      </div>
    </div>
  );
}

/**
 * Five vertical lantern-style bars, one per tier — the visual rank
 * ladder. Each lantern shows the tier kanji at the top, an earned/total
 * count below, and a vertical fill bar in the tier's colour gradient.
 *
 * Why vertical (and not the prior horizontal mini-bars)? The metaphor
 * carries the festival theme — paper lanterns hang in a row at a
 * matsuri, and only the ones the visitor has "lit" glow with full
 * colour. Tiers with zero earned read as unlit lanterns — present in
 * the row, not yet bright.
 */
function TierLanterns({ tierStats, highestTier, t }) {
  return (
    <div
      className="mt-7 grid grid-cols-5 gap-2 sm:gap-3"
      aria-label={t("seals.tierLegend")}
    >
      {Object.entries(TIERS).map(([tier, { name, label }]) => {
        const stats = tierStats[tier] || { earned: 0, total: 0 };
        const ratio = stats.total > 0 ? stats.earned / stats.total : 0;
        const ratioPct = Math.round(ratio * 100);
        const lit = stats.earned > 0;
        const isCurrent = parseInt(tier, 10) === highestTier;
        return (
          <div
            key={tier}
            className={`group relative flex flex-col items-stretch overflow-hidden rounded-lg border bg-ink-1/40 backdrop-blur transition ${
              isCurrent
                ? "border-hanko/50 shadow-[0_0_18px_rgba(220,38,38,0.25)]"
                : lit
                  ? "border-border hover:border-washi-muted/40"
                  : "border-border/60"
            }`}
          >
            {/* Lantern "head" — kanji + count */}
            <div className="flex flex-col items-center px-2 pt-3 pb-1.5">
              <span
                className={`font-jp text-lg font-bold leading-none transition-transform group-hover:scale-110 ${
                  lit ? "text-washi" : "text-washi-dim"
                }`}
              >
                {label}
              </span>
              <span className="mt-1.5 font-mono text-[9px] tabular-nums text-washi-muted">
                {stats.earned}
                <span className="text-washi-dim">/{stats.total}</span>
              </span>
            </div>
            {/* Lantern "body" — vertical fill bar in tier colour. Min
                height of 36px so even at 0% the lantern reads as
                present rather than collapsed. */}
            <div
              className={`relative mx-1.5 mb-2 h-9 overflow-hidden rounded bg-ink-2/80 tier-bar-${name}`}
            >
              <div
                className="absolute bottom-0 left-0 right-0 transition-[height] duration-700 ease-out"
                style={{ height: `${Math.max(ratioPct, lit ? 8 : 0)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The "QUEST" card — appears when there's at least one unearned seal
 * and no newly-granted banner is competing for attention. Bigger and
 * more inviting than the previous chip; reads like a JRPG quest prompt.
 */
function NextQuestCard({ seal, t }) {
  return (
    <div
      className="relative mb-12 overflow-hidden rounded-2xl border border-sakura/35 bg-gradient-to-br from-sakura/10 via-ink-1/60 to-ink-1/30 p-5 shadow-[0_8px_30px_rgba(247,170,200,0.12)] backdrop-blur animate-fade-up sm:p-6"
      style={{ animationDelay: "100ms" }}
    >
      {/* Background watermark of the target kanji — gives the card the
          "you can almost touch this" feel. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 -right-2 select-none font-jp text-[14rem] font-bold leading-none text-sakura/[0.08]"
      >
        {seal.kanji}
      </span>

      <div className="relative flex items-center gap-5">
        {/* Mock seal silhouette — same dashed treatment as unearned
            seals in the grid. */}
        <div className="hidden h-20 w-20 shrink-0 place-items-center rounded-md border-2 border-dashed border-sakura/55 bg-ink-0/40 sm:grid">
          <span className="font-jp text-3xl font-bold leading-none text-sakura/80">
            {seal.kanji}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-sakura">
            {t("seals.questLabel")}
          </p>
          <p className="mt-1 font-display text-xl italic text-washi md:text-2xl">
            {t(`seals.codes.${seal.code}.label`)}
          </p>
          <p className="mt-1.5 line-clamp-2 max-w-xl font-sans text-xs text-washi-muted md:text-sm">
            {t(`seals.codes.${seal.code}.description`)}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Newly-granted banner with kinetic sparks. Same i18n keys as before —
 * the change is purely visual punch. Sparks twinkle in slightly
 * out-of-phase pulses so the row reads as a continuous shimmer rather
 * than a synchronous blink.
 */
function NewlyGrantedBanner({ count, t }) {
  return (
    <div
      className="relative mb-10 overflow-hidden rounded-2xl border border-hanko/40 bg-gradient-to-br from-hanko/15 via-ink-1/80 to-moegi/15 p-5 shadow-[0_8px_32px_rgba(220,38,38,0.18)] backdrop-blur animate-fade-up"
      role="status"
      aria-live="polite"
      style={{ animationDelay: "80ms" }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-3 left-3 h-1.5 w-1.5 rounded-full bg-gold/80"
        style={{ animation: "seal-spark 2.4s ease-in-out infinite" }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-4 left-14 h-1 w-1 rounded-full bg-hanko/80"
        style={{
          animation: "seal-spark 2.4s ease-in-out 0.6s infinite",
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-1 left-20 h-1 w-1 rounded-full bg-moegi/80"
        style={{
          animation: "seal-spark 2.4s ease-in-out 1.1s infinite",
        }}
      />
      <div className="relative flex items-center gap-4">
        <div
          className="hanko-seal grid h-14 w-14 shrink-0 place-items-center rounded-md font-display text-xl shadow-[0_4px_18px_rgba(220,38,38,0.4)]"
          style={{ transform: "rotate(-6deg)" }}
        >
          新
        </div>
        <div className="flex-1">
          <p className="font-display text-lg italic text-washi md:text-xl">
            {count === 1
              ? t("seals.newlyGrantedOne")
              : t("seals.newlyGrantedMany", { n: count })}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted">
            {t("seals.newlyGrantedHint")}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * One category section. Wraps the grid of <Seal> tiles with:
 *   · a "CHAPITRE N · 章" eyebrow and a brushstroke divider
 *   · a kanji medallion + huge italic title + scoreboard counter
 *   · a celebratory "CHAPITRE COMPLET" banner with sweeping shimmer,
 *     shown only when every seal in the category is earned.
 */
function CategorySection({
  category,
  chapterNumber,
  animationDelay,
  categoryEarned,
  categoryComplete,
  earnedMap,
  newlySet,
  currentCode,
  ceremonyManaged,
  t,
}) {
  return (
    <section
      className="relative mb-16 animate-fade-up"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {/* Chapter eyebrow — locates the section in the journal */}
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-washi-dim">
          {t("seals.chapterPrefix", { n: chapterNumber })}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-border via-border/40 to-transparent" />
        <span className="font-jp text-[10px] tracking-[0.4em] text-washi-dim">
          {category.kanji}
        </span>
      </div>

      {/* Header row — large kanji medallion + title block + counter */}
      <div className="mb-6 flex items-center gap-4">
        <div
          className={`relative grid h-16 w-16 shrink-0 place-items-center rounded-lg font-display text-xl transition-shadow ${
            categoryComplete
              ? "hanko-seal shadow-[0_0_28px_rgba(212,160,57,0.45)] ring-1 ring-gold/45"
              : "hanko-seal"
          }`}
          style={{ transform: "rotate(-3deg)" }}
        >
          {category.kanji}
          {categoryComplete && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-gradient-to-br from-gold to-gold-muted shadow-[0_0_10px_rgba(212,160,57,0.7)]"
              style={{ animation: "seal-spark 3s ease-in-out infinite" }}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl italic leading-tight text-washi md:text-3xl">
            {t(`seals.categories.${category.code}`)}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
            {t(`seals.categoryHint.${category.code}`)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display italic text-washi">
            <span
              className={`text-3xl font-semibold tabular-nums not-italic ${
                categoryComplete
                  ? "text-gold"
                  : categoryEarned > 0
                    ? "text-hanko-bright"
                    : "text-washi-dim"
              }`}
            >
              {categoryEarned}
            </span>
            <span className="font-mono text-sm text-washi-dim">
              /{category.seals.length}
            </span>
          </p>
        </div>
      </div>

      {/* "CHAPITRE COMPLET" celebration — only rendered when the user
          has earned every seal in this category. The shimmer track
          sweeps a diagonal gold sheen across the banner every ~3.6s. */}
      {categoryComplete && (
        <div className="relative mb-5 overflow-hidden rounded-xl border border-gold/40 bg-gradient-to-r from-gold/10 via-gold/15 to-gold/10 px-4 py-2.5 backdrop-blur">
          <span
            aria-hidden="true"
            className="seal-chapter-shimmer-track"
          />
          <div className="relative flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-gradient-to-br from-gold to-gold-muted font-jp text-sm font-bold leading-none text-ink-0 shadow"
              style={{ transform: "rotate(-4deg)" }}
            >
              完
            </span>
            <p className="flex-1 font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-gold">
              {t("seals.chapterCleared")}
            </p>
            <p className="hidden font-display text-xs italic text-washi-muted sm:inline">
              {t("seals.chapterClearedHint")}
            </p>
          </div>
        </div>
      )}

      {/* Seal grid — unchanged behaviour, just a tighter visual stagger */}
      <div
        role="list"
        className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      >
        {category.seals.map((seal, i) => (
          <div
            key={seal.code}
            data-seal-code={seal.code}
            className="animate-fade-up"
            style={{
              animationDelay: `${Math.min(180 + i * 40, 500)}ms`,
            }}
          >
            <Seal
              code={seal.code}
              kanji={seal.kanji}
              tier={seal.tier}
              earned={earnedMap.has(seal.code)}
              earnedAt={earnedMap.get(seal.code)}
              newly={newlySet.has(seal.code)}
              playing={currentCode === seal.code}
              ceremonyManaged={ceremonyManaged}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Skeleton mirrors the real `<CategorySection>` structure published
 * in the festival redesign: chapter eyebrow + brushstroke divider +
 * medallion / title / counter row + per-tile cover-and-name grid.
 * Each block uses the same Tailwind dimensions as the real elements
 * so the layout doesn't shift when the data resolves and the real
 * sections take over (no CLS).
 */
function SealsPageSkeleton() {
  return (
    <div className="space-y-14">
      {[0, 1, 2].map((i) => (
        <section key={i} className="relative">
          {/* Chapter eyebrow + dotted divider — matches the real
              `flex items-baseline gap-3` row above each section */}
          <div className="mb-3 flex items-baseline gap-3">
            <Skeleton className="h-3 w-24 rounded" />
            <span className="h-px flex-1 bg-gradient-to-r from-border via-border/40 to-transparent" />
            <Skeleton className="h-3 w-4 rounded" />
          </div>

          {/* Header row: medallion + title block + score */}
          <div className="mb-6 flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-lg" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-7 w-48 rounded" />
              <Skeleton className="mt-1.5 h-3 w-64 rounded" />
            </div>
            <Skeleton className="h-9 w-14 rounded" />
          </div>

          {/* Tile grid — same columns as the real seal grid so the
              skeleton occupies exactly the slots the data will. The
              kanji-bearing rounded squares are h-24/h-28 with a name
              line beneath; we mirror both. */}
          <div
            className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            aria-hidden="true"
          >
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((j) => (
              <div key={j} className="flex flex-col items-center">
                <Skeleton
                  className="h-24 w-24 rounded-md lg:h-28 lg:w-28"
                  // Stagger the shimmer phase so the row reads as
                  // a wave instead of a single block of pulses.
                  style={{ animationDelay: `${j * 80}ms` }}
                />
                <Skeleton className="mt-3 h-3 w-20 rounded" />
                <Skeleton className="mt-1 h-2 w-12 rounded opacity-60" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
