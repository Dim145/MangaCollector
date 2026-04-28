import { useEffect, useMemo, useRef, useState } from "react";
import DefaultBackground from "./DefaultBackground";
import Seal from "./ui/Seal.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { useSeals } from "@/hooks/useSeals.js";
import { SEALS_BY_CATEGORY, SEAL_CATALOG, TIERS } from "@/lib/sealsCatalog.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 印鑑帳 — Carnet de sceaux.
 *
 * A dedicated "journal" page where every ceremonial milestone the user
 * has earned appears as a real hanko stamp, and every unearned one
 * appears as a dashed silhouette. Sections are grouped by category
 * (Débuts / Progression / Étagère / Complétion / Collector / Coffrets /
 * Diversité / Ancienneté) so the journal reads chapter by chapter.
 *
 * On mount, the server evaluates the catalog and may grant newly-
 * qualifying seals. Those come back in `newly_granted`; we pass the flag
 * into <Seal newly={…} /> so the newly-earned stamps play an emphatic
 * ceremony animation (scale-overshoot + hanko glow halo) exactly once.
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
  //
  // For each code in `newly_granted`, in order:
  //   1. scroll the matching seal into the centre of the viewport
  //   2. dim the rest of the page with a translucent ink overlay
  //   3. raise the focal seal above the overlay and replay an
  //      amplified seal-ceremony animation in place
  //   4. hold long enough to read it, then advance to the next
  //
  // Skipping (tap on the overlay or Escape) jumps straight to the
  // next index; once the queue empties, the overlay fades and the
  // page returns to its idle state. The `consumedRef` guards
  // against re-running the loop on incidental re-renders (the hook
  // keeps `newly_granted` reference-stable for the page's lifetime).
  const consumedRef = useRef(null);
  // -1 idle · 0..N-1 currently spotlighting that index in newly_granted.
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

    // Helper that resolves on its timer or early when the user taps
    // skip — the active resolver is stashed on `skipRef.current` so
    // the click handler can fire it.
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

    // 探 · Resolve the seal DOM target, retrying up to ~600ms in case
    // the category section is still in its `animate-fade-up` mount
    // delay (`Math.min(180 + i * 40, 500)` for the staggered reveal).
    // Without this, an early ceremony tick could find `target = null`,
    // skip the scroll silently, and spotlight an offscreen card.
    const findSealTarget = async (code) => {
      const deadline = Date.now() + 600;
      while (Date.now() < deadline) {
        const el = document.querySelector(`[data-seal-code="${code}"]`);
        if (el) return el;
        // Wait one frame and retry — cheap on mount-pending DOM,
        // immediately resolved once the section is painted.
        await new Promise((r) => requestAnimationFrame(r));
      }
      // Fallback to the last attempt; null is acceptable downstream
      // (the ceremony just skips the scroll for this seal).
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
        // Let the scroll settle. 700ms is a comfortable overshoot for
        // browser-native smooth scrolling on most viewports; cancelling
        // mid-flight stays safe because the next iteration just runs
        // its own scrollIntoView.
        await interruptible(700);
        if (cancelled) return;

        setCeremonyIndex(i);
        // Hold the spotlight long enough to read the seal's name and
        // see the stamp settle. ~2.4s feels generous without dragging.
        try {
          navigator.vibrate?.([18, 50, 80]);
        } catch {
          /* haptic unsupported — silent */
        }
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

  const handleOverlayClick = () => {
    // Click anywhere on the dimmer — fast-forward through the rest.
    skipRef.current?.();
  };

  const earnedCount = earnedMap.size;
  const totalCount = SEAL_CATALOG.length;
  const percent = Math.round((earnedCount / totalCount) * 100);

  // 階 · Per-tier breakdown — used by the tier panel below the progress
  // bar. Lets the visitor see "I'm 80% on the common tiers but 0% on
  // legendary" at a glance, instead of a single conflated %.
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

  // 近 · "Closest seal" — used below the masthead to point the visitor
  // at something tangible to chase next. Picks the lowest-tier unearned
  // seal so the suggestion always feels reachable rather than aspirational.
  // Falls back to null when every seal is earned (full collection).
  const nextSeal = useMemo(() => {
    return (
      [...SEAL_CATALOG]
        .filter((s) => !earnedMap.has(s.code))
        .sort((a, b) => a.tier - b.tier)[0] ?? null
    );
  }, [earnedMap]);

  return (
    <DefaultBackground>
      {/* 儀式 · Ceremony dimmer. Sits between the page (z auto) and
          the spotlighted seal (z-50 via .seal-spotlight). Tint only —
          no backdrop-blur — because blurring the rest of the journal
          obscures the celebration of seeing the carnet fill in (the
          previous draft used 2px blur, which read as a dropped focus
          rather than a focused dim). The translucent ink is enough
          to push the focal seal forward.
          Pointer-events: auto so a tap fast-forwards through the
          queue — the user is never trapped. */}
      {ceremonyIndex >= 0 && (
        <button
          type="button"
          aria-label={t("seals.ceremonySkip")}
          onClick={handleOverlayClick}
          className="fixed inset-0 z-40 cursor-pointer animate-fade-in bg-ink-0/40 focus:outline-none"
        />
      )}
      <div className="relative mx-auto max-w-6xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* ───── Masthead ─────
            Two-column composition: text+progress on the left, ornamental
            "carnet" panel on the right (kanji medallion + tier breakdown).
            On mobile, stacks vertically — the medallion drops to a slim
            ribbon under the title so the progress bar always reads above
            the fold. */}
        <header className="relative mb-12 animate-fade-up">
          {/* 印 watermark — anchored inside its own clip-layer (mirrors
              the PublicProfile / ComparePage pattern) so the gold
              kanji doesn't bleed past the masthead and the hanko-rule
              chips below it stay un-clipped. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl"
          >
            <span
              className="absolute -top-6 right-2 select-none font-jp text-[22rem] font-bold leading-none text-gold/[0.07]"
              style={{
                animation: "seal-watermark-drift 12s ease-in-out infinite",
              }}
            >
              印
            </span>
            {/* Atmospheric blooms — hanko top-left, gold bottom-right.
                Mirrors the warmth of an oxidising paper edge. */}
            <div className="absolute -top-32 -left-32 h-72 w-72 rounded-full bg-hanko/10 blur-3xl" />
            <div className="absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-gold/10 blur-3xl" />
          </div>

          <div className="relative">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.3em] text-hanko">
                {t("seals.eyebrow")}
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent" />
              <span className="hidden font-jp text-[10px] tracking-[0.3em] text-washi-dim sm:inline">
                印鑑帳
              </span>
            </div>

            {/* Title row — h1 + a stamped 印 medallion to the right that
                ties into the watermark behind. */}
            <div className="mt-3 flex items-start justify-between gap-6">
              <h1 className="flex-1 font-display text-4xl font-light italic leading-[0.95] tracking-tight text-washi md:text-6xl">
                {t("seals.yourTitle")}{" "}
                <span className="text-hanko-gradient font-semibold not-italic">
                  {t("seals.titleAccent")}
                </span>
              </h1>
              {/* Ornamental medallion — mirrors the in-grid hanko-seal
                  styling but at a hero scale. Rotated -4deg to look
                  hand-stamped onto the page. */}
              <div
                aria-hidden="true"
                className="hanko-seal hidden h-16 w-16 shrink-0 place-items-center rounded-md font-display text-2xl shadow-[0_8px_24px_rgba(220,38,38,0.35)] sm:grid"
                style={{ transform: "rotate(-4deg)" }}
              >
                印
              </div>
            </div>

            <p className="mt-4 max-w-xl font-sans text-sm leading-relaxed text-washi-muted">
              {t("seals.subtitle")}
            </p>

            {/* Two-row progress block:
                  · ROW 1 — overall progress bar with shimmer + stamp marker
                  · ROW 2 — per-tier breakdown panel (5 mini bars in tier colours) */}
            <div className="mt-8 space-y-5">
              {/* Overall progress */}
              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
                    {t("seals.progressLabel")}
                  </p>
                  <p className="font-display text-base italic text-washi">
                    <span className="font-semibold not-italic text-hanko-bright tabular-nums">
                      {earnedCount}
                    </span>{" "}
                    <span className="text-washi-dim">
                      / {totalCount} · {percent}%
                    </span>
                  </p>
                </div>
                {/* Bar — taller than before (h-1.5 vs h-[3px]) and
                    overlaid with a subtle shimmer band so the
                    "ink-still-wet" feel reads even when nothing has
                    just changed. The marker dot at the leading edge
                    behaves like the tip of a brush still pressed to
                    paper. */}
                <div className="seal-progress-rail mt-2 relative h-1.5 w-full overflow-hidden rounded-full bg-ink-2/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-hanko-deep via-hanko to-hanko-bright transition-all duration-1000 ease-out"
                    style={{
                      width: `${percent}%`,
                      boxShadow: percent > 0 ? "0 0 10px var(--hanko-glow)" : "none",
                    }}
                  />
                  {percent > 0 && percent < 100 && (
                    <span
                      aria-hidden="true"
                      className="seal-progress-marker absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hanko shadow-[0_0_12px_var(--hanko-glow)]"
                      style={{ left: `${percent}%` }}
                    />
                  )}
                </div>
              </div>

              {/* Per-tier breakdown — replaces the old inline legend.
                  Five tiny bars in their tier colours, each labelled
                  with the JP tier name + earned/total count. Reads as
                  a "rank ladder" so the visitor can spot which tier
                  is closest to filling out. */}
              <TierBreakdown tierStats={tierStats} t={t} />
            </div>
          </div>
        </header>

        {/* ───── Newly-granted banner ─────
            Re-themed: gradient hanko -> moegi (fresh ink lands on the
            paper), with a sparking 新 stamp on the left and a chevron
            cue on the right hinting "scroll down to see them light up". */}
        {newlySet.size > 0 && (
          <div
            className="relative mb-10 overflow-hidden rounded-2xl border border-hanko/40 bg-gradient-to-br from-hanko/15 via-ink-1/80 to-moegi/15 p-5 shadow-[0_8px_32px_rgba(220,38,38,0.18)] backdrop-blur animate-fade-up"
            role="status"
            aria-live="polite"
            style={{ animationDelay: "80ms" }}
          >
            {/* Tiny floating sparks behind the 新 stamp */}
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
                  {newlySet.size === 1
                    ? t("seals.newlyGrantedOne")
                    : t("seals.newlyGrantedMany", { n: newlySet.size })}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted">
                  {t("seals.newlyGrantedHint")}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ───── Next-up hint ─────
            Tiny suggestion card pointing at the closest unearned seal,
            so the visitor leaves the page with a concrete "next stop"
            instead of a vague "earn more". Hidden when there's nothing
            left to earn (full carnet) or while loading. */}
        {!isLoading && nextSeal && newlySet.size === 0 && (
          <div
            className="mb-10 inline-flex items-center gap-3 rounded-full border border-border bg-ink-1/60 px-4 py-2 backdrop-blur animate-fade-up"
            style={{ animationDelay: "100ms" }}
          >
            <span
              aria-hidden="true"
              className="grid h-7 w-7 place-items-center rounded border border-dashed border-washi-dim/50 font-jp text-[12px] text-washi-dim"
            >
              {nextSeal.kanji}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-muted">
              {t("seals.nextHint", {
                name: t(`seals.codes.${nextSeal.code}.label`),
              })}
            </span>
          </div>
        )}

        {/* ───── Loading state ───── */}
        {isLoading && <SealsPageSkeleton />}

        {/* ───── Sections by category ───── */}
        {!isLoading &&
          SEALS_BY_CATEGORY.map((category, ci) => {
            const categoryEarned = category.seals.filter((s) =>
              earnedMap.has(s.code),
            ).length;
            const categoryComplete = categoryEarned === category.seals.length;
            return (
              <section
                key={category.code}
                className="relative mb-14 animate-fade-up"
                style={{ animationDelay: `${120 + ci * 50}ms` }}
              >
                {/* Brushstroke divider above each section — gradient
                    that fades in/out, anchored to the medallion. Gives
                    the page a "page-break in a journal" rhythm. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none mb-6 flex items-center gap-3"
                >
                  <span className="h-px w-8 bg-gradient-to-r from-transparent to-border" />
                  <span className="font-jp text-[10px] tracking-[0.4em] text-washi-dim">
                    {category.kanji}
                  </span>
                  <span className="h-px flex-1 bg-gradient-to-r from-border via-border/40 to-transparent" />
                </div>

                {/* Category header — bigger medallion than before, with
                    a soft glow when this category is fully earned (the
                    "completed chapter" celebration). The kanji wears
                    a subtle ring of sumi-dots when partial, gold when
                    full — without ever competing visually with the
                    in-grid seals. */}
                <div className="mb-6 flex items-center gap-4">
                  <div
                    className={`relative grid h-14 w-14 shrink-0 place-items-center rounded-lg font-display text-lg transition-shadow ${
                      categoryComplete
                        ? "hanko-seal shadow-[0_0_24px_rgba(212,160,57,0.4)] ring-1 ring-gold/40"
                        : "hanko-seal"
                    }`}
                    style={{ transform: "rotate(-3deg)" }}
                  >
                    {category.kanji}
                    {/* Tiny gold satellite dot — lights up only when
                        the chapter is fully earned. */}
                    {categoryComplete && (
                      <span
                        aria-hidden="true"
                        className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-gradient-to-br from-gold to-gold-muted shadow-[0_0_8px_rgba(212,160,57,0.6)]"
                        style={{
                          animation:
                            "seal-spark 3s ease-in-out infinite",
                        }}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-xl italic text-washi md:text-2xl">
                      {t(`seals.categories.${category.code}`)}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                      {t(`seals.categoryHint.${category.code}`)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-2xl italic text-washi">
                      <span
                        className={`tabular-nums not-italic ${
                          categoryComplete
                            ? "text-gold"
                            : categoryEarned > 0
                              ? "text-hanko-bright"
                              : "text-washi-dim"
                        }`}
                      >
                        {categoryEarned}
                      </span>
                      <span className="font-mono text-[12px] text-washi-dim">
                        /{category.seals.length}
                      </span>
                    </p>
                  </div>
                </div>

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
                        // While the ceremony loop is in flight, we
                        // don't let any other seal play its baseline
                        // `animate-seal-ceremony` reveal. Otherwise
                        // the seal that just left the spotlight would
                        // pick up a fresh animation pass when its
                        // class set changed (browser animation engines
                        // restart on class swap), causing a phantom
                        // re-bump every time we advance.
                        ceremonyManaged={newlyList.length > 0}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
      </div>
    </DefaultBackground>
  );
}

/**
 * Per-tier earned/total breakdown — five mini-bars in the tier's own
 * colour, stacked horizontally on desktop, vertically on narrow mobile.
 * Each row reads at a glance: kanji label + ratio + filled portion.
 *
 * Why this replaces the legacy "tier legend dot row":
 *   - The legend only said *what* the colours mean — it required hover
 *     on every individual seal to learn how many you'd earned in each
 *     rank. The breakdown answers both questions at once: the colour
 *     *and* the progress within it.
 *   - Visitors with a near-empty carnet now see "0 / 5 sumi" in plain
 *     ink rather than just "墨", which reads as a target rather than a
 *     decoration.
 */
function TierBreakdown({ tierStats, t }) {
  return (
    <div
      className="rounded-xl border border-border/60 bg-ink-1/40 p-3 backdrop-blur sm:p-4"
      aria-label={t("seals.tierLegend")}
    >
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
        {t("seals.tierLegend")}
      </p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-5 sm:gap-3">
        {Object.entries(TIERS).map(([tier, { name, label }]) => {
          const stats = tierStats[tier] || { earned: 0, total: 0 };
          const ratio = stats.total > 0 ? stats.earned / stats.total : 0;
          const ratioPct = Math.round(ratio * 100);
          return (
            <div key={tier} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-baseline gap-1.5">
                  <span
                    className={`tier-legend-dot tier-legend-${name}`}
                    aria-hidden="true"
                  />
                  <span className="font-jp text-[12px] text-washi">
                    {label}
                  </span>
                </span>
                <span className="font-mono text-[10px] tabular-nums text-washi-muted">
                  {stats.earned}
                  <span className="text-washi-dim">/{stats.total}</span>
                </span>
              </div>
              <div
                className={`mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ink-2/80 tier-bar-${name}`}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${ratioPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SealsPageSkeleton() {
  return (
    <div className="space-y-10">
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div className="mb-5 flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-lg" />
            <div className="flex-1">
              <Skeleton className="h-5 w-40 rounded" />
              <Skeleton className="mt-1 h-3 w-60 rounded" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((j) => (
              <div key={j} className="flex flex-col items-center">
                <Skeleton className="h-24 w-24 rounded-md lg:h-28 lg:w-28" />
                <Skeleton className="mt-3 h-3 w-20 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
