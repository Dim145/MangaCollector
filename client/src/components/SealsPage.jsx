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
      <div className="mx-auto max-w-6xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* ───── Masthead ───── */}
        <header className="mb-10 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
              {t("seals.eyebrow")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h1 className="mt-2 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-6xl">
            {t("seals.yourTitle")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("seals.titleAccent")}
            </span>
          </h1>
          <p className="mt-4 max-w-xl font-sans text-sm text-washi-muted">
            {t("seals.subtitle")}
          </p>

          {/* Progress — ceremonial bar, stained-ink feel. The rail is the
              "paper" where stamps will land; the filled portion is the
              accumulated red wash of the sceaux you've earned. */}
          <div className="mt-8 flex items-baseline justify-between gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("seals.progressLabel")}
            </p>
            <p className="font-display text-sm italic text-washi">
              <span className="font-semibold not-italic text-hanko-bright tabular-nums">
                {earnedCount}
              </span>{" "}
              <span className="text-washi-dim">
                / {totalCount} · {percent}%
              </span>
            </p>
          </div>
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-ink-2/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-hanko-deep via-hanko to-hanko-bright transition-all duration-700 ease-out"
              style={{ width: `${percent}%`, boxShadow: percent > 0 ? "0 0 8px var(--hanko-glow)" : "none" }}
            />
          </div>

          {/* Tier legend — inline row of 5 coloured dots so users can
              decipher the palette without hovering every seal. Responsive:
              labels hide on very narrow mobile. */}
          <div
            className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
            aria-label={t("seals.tierLegend")}
          >
            <span className="text-washi-muted">{t("seals.tierLegend")}</span>
            {Object.entries(TIERS).map(([n, { name, label }]) => (
              <span key={n} className="inline-flex items-center gap-2">
                <span className={`tier-legend-dot tier-legend-${name}`} aria-hidden="true" />
                <span className="font-jp text-[11px] normal-case tracking-normal text-washi-muted">
                  {label}
                </span>
                <span className="hidden sm:inline">{t(`seals.tiers.${name}`).split("·")[1]?.trim() ?? ""}</span>
              </span>
            ))}
          </div>
        </header>

        {/* ───── Newly-granted banner ───── */}
        {newlySet.size > 0 && (
          <div
            className="mb-10 overflow-hidden rounded-xl border border-hanko/40 bg-gradient-to-br from-hanko/15 via-ink-1/80 to-ink-1/50 p-5 backdrop-blur animate-fade-up"
            role="status"
            aria-live="polite"
            style={{ animationDelay: "80ms" }}
          >
            <div className="flex items-center gap-4">
              <div className="hanko-seal grid h-12 w-12 shrink-0 place-items-center rounded-md font-display text-lg">
                新
              </div>
              <div>
                <p className="font-display text-lg italic text-washi">
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

        {/* ───── Loading state ───── */}
        {isLoading && <SealsPageSkeleton />}

        {/* ───── Sections by category ───── */}
        {!isLoading &&
          SEALS_BY_CATEGORY.map((category, ci) => {
            const categoryEarned = category.seals.filter((s) =>
              earnedMap.has(s.code),
            ).length;
            return (
              <section
                key={category.code}
                className="mb-12 animate-fade-up"
                style={{ animationDelay: `${120 + ci * 50}ms` }}
              >
                {/* Category header — kanji medallion + dashed divider +
                    progress fraction for this category */}
                <div className="mb-5 flex items-center gap-4">
                  <div className="hanko-seal grid h-11 w-11 shrink-0 place-items-center rounded-md font-display text-base">
                    {category.kanji}
                  </div>
                  <div className="flex-1">
                    <p className="font-display text-xl italic text-washi">
                      {t(`seals.categories.${category.code}`)}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                      {t(`seals.categoryHint.${category.code}`)}
                    </p>
                  </div>
                  <p className="font-mono text-[11px] tabular-nums text-washi-muted">
                    {categoryEarned}
                    <span className="text-washi-dim">/{category.seals.length}</span>
                  </p>
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

function SealsPageSkeleton() {
  return (
    <div className="space-y-10">
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div className="mb-5 flex items-center gap-4">
            <Skeleton className="h-11 w-11 rounded-md" />
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
