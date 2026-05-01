import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Modal from "./ui/Modal.jsx";
import { markTourSeen, setTourStep, TOUR_STEPS } from "@/lib/tour.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 始 · Welcome tour — atelier edition.
 *
 * The earlier paginated revision laid out the right INFORMATION but
 * carried it on flat, generic UI: centered titles, evenly-spaced cards,
 * dot pagination. Functional, but the experience didn't echo the rest
 * of the app — Shōjo Noir, ink black, hand-pressed hanko, washi paper,
 * gold leaf.
 *
 * This revision commits to a single visual metaphor: the user is
 * leafing through an antique catalogue, and each chapter is being
 * stamped onto the page in front of them. Concretely:
 *
 *   • Each page's category kanji is HUGE (10-14 rem) and partially
 *     bleeds off the modal's left edge. On entry it animates with the
 *     `tour-stamp-press` keyframe — starts small + tilted + blurred,
 *     overshoots scale, then settles at a permanent crooked angle. A
 *     companion ink-bloom ring expands behind it. Same vocabulary as
 *     a real hanko being pressed onto wet paper.
 *
 *   • The modal backdrop carries gold + hanko radial blooms, a SVG
 *     noise overlay (washi grain), and 12 floating ink particles that
 *     drift in slow bezier paths. The particles are positioned + timed
 *     deterministically so the layout doesn't reflow between renders.
 *
 *   • Feature cards rest at slightly different rotations
 *     (-1.2° / +0.5° / -0.6°) so the row feels hand-arranged. On hover
 *     each card straightens, lifts, and gains a gold ring. Each card
 *     carries a circular hanko stamp at the top-left and a folded
 *     bottom-right corner (clip-path triangle) to read as printed
 *     paper rather than a generic UI tile.
 *
 *   • Page transitions still slide horizontally (existing slide track
 *     translateX), but the OUTGOING page also fades + blurs slightly
 *     so the eye locks onto the incoming kanji being stamped.
 *
 *   • Progress isn't dots anymore — it's a sumi-ink trail that fills
 *     left-to-right with a small 印 traveling along it. Reads like a
 *     scroll being unrolled.
 *
 * The tour categories + features are unchanged from the previous
 * revision; this is a pure presentation overhaul. Re-triggerable from
 * Settings via `resetTourSeen()` + `<WelcomeTour>`.
 */

// 章 · Category catalogue. Same content as before — 4 chapters, 3
// features each. Per-card tilt classes are A/B/C cycled in order;
// CSS handles the rest.
const CATEGORIES = [
  {
    id: "build",
    kanji: "収",
    romaji: "shū",
    titleKey: "tour.cat1Title",
    bodyKey: "tour.cat1Body",
    features: [
      {
        id: "library",
        kanji: "始",
        romaji: "hajime",
        titleKey: "tour.s1Title",
        bodyKey: "tour.s1Body",
        ctaKey: "tour.s1Cta",
        path: "/addmanga",
        step: TOUR_STEPS.LIBRARY,
      },
      {
        id: "scan",
        kanji: "探",
        romaji: "sagasu",
        titleKey: "tour.s2Title",
        bodyKey: "tour.s2Body",
        ctaKey: "tour.s2Cta",
        path: "/addmanga",
        step: TOUR_STEPS.SCAN,
      },
      {
        id: "calendar",
        kanji: "暦",
        romaji: "koyomi",
        titleKey: "tour.fCalendarTitle",
        bodyKey: "tour.fCalendarBody",
        ctaKey: "tour.fCalendarCta",
        path: "/calendrier",
      },
    ],
  },
  {
    id: "personal",
    kanji: "個",
    romaji: "ko",
    titleKey: "tour.cat2Title",
    bodyKey: "tour.cat2Body",
    features: [
      {
        id: "avatar",
        kanji: "印",
        romaji: "in",
        titleKey: "tour.s3Title",
        bodyKey: "tour.s3Body",
        ctaKey: "tour.s3Cta",
        path: "/profile",
        step: TOUR_STEPS.AVATAR,
      },
      {
        id: "accent",
        kanji: "朱",
        romaji: "shu",
        titleKey: "tour.fAccentTitle",
        bodyKey: "tour.fAccentBody",
        ctaKey: "tour.fAccentCta",
        path: "/settings#appearance",
      },
      {
        id: "feedback",
        kanji: "響",
        romaji: "hibiki",
        titleKey: "tour.fFeedbackTitle",
        bodyKey: "tour.fFeedbackBody",
        ctaKey: "tour.fFeedbackCta",
        path: "/settings#appearance",
      },
    ],
  },
  {
    id: "power",
    kanji: "鍵",
    romaji: "kagi",
    titleKey: "tour.cat3Title",
    bodyKey: "tour.cat3Body",
    features: [
      {
        id: "palette",
        kanji: "検",
        romaji: "ken",
        titleKey: "tour.fPaletteTitle",
        bodyKey: "tour.fPaletteBody",
        ctaKey: "tour.fPaletteCta",
        synthetic: { key: "k", metaKey: true, ctrlKey: true },
      },
      {
        id: "shortcuts",
        kanji: "鍵",
        romaji: "kagi",
        titleKey: "tour.fShortcutsTitle",
        bodyKey: "tour.fShortcutsBody",
        ctaKey: "tour.fShortcutsCta",
        synthetic: { key: "?" },
      },
      {
        id: "bulk",
        kanji: "選",
        romaji: "sen",
        titleKey: "tour.fBulkTitle",
        bodyKey: "tour.fBulkBody",
        ctaKey: "tour.fBulkCta",
        path: "/dashboard",
      },
    ],
  },
  {
    id: "share",
    kanji: "共",
    romaji: "kyō",
    titleKey: "tour.cat4Title",
    bodyKey: "tour.cat4Body",
    features: [
      {
        id: "public",
        kanji: "公",
        romaji: "kō",
        titleKey: "tour.fPublicTitle",
        bodyKey: "tour.fPublicBody",
        ctaKey: "tour.fPublicCta",
        path: "/settings#account",
      },
      {
        id: "snapshot",
        kanji: "撮",
        romaji: "satsu",
        titleKey: "tour.fSnapshotTitle",
        bodyKey: "tour.fSnapshotBody",
        ctaKey: "tour.fSnapshotCta",
        path: "/profile",
        step: TOUR_STEPS.SNAPSHOT,
      },
      {
        id: "seals",
        kanji: "印",
        romaji: "in",
        titleKey: "tour.fSealsTitle",
        bodyKey: "tour.fSealsBody",
        ctaKey: "tour.fSealsCta",
        path: "/seals",
      },
    ],
  },
];

const TOTAL_PAGES = 1 + CATEGORIES.length + 1;
const INTRO_INDEX = 0;
const OUTRO_INDEX = TOTAL_PAGES - 1;

const CARD_TILTS = ["tour-card-tilt-a", "tour-card-tilt-b", "tour-card-tilt-c"];

// 漂 · Pre-computed particle layout — fixed positions + timings so the
// pattern reads as "intentional" rather than "random screen-saver".
// 12 dots is the sweet spot: enough to fill the eye, sparse enough to
// feel like incense rather than a snowstorm. Kept outside the
// component so each render reuses the same array and React can
// reconcile by index without churn.
const PARTICLES = [
  { x: 8, y: 22, size: 2, delay: 0, dur: 14 },
  { x: 18, y: 70, size: 1.5, delay: 2, dur: 12 },
  { x: 26, y: 14, size: 1, delay: 4, dur: 16 },
  { x: 32, y: 56, size: 2.5, delay: 6, dur: 13 },
  { x: 44, y: 86, size: 1, delay: 1, dur: 15 },
  { x: 52, y: 28, size: 1.5, delay: 3, dur: 11 },
  { x: 60, y: 64, size: 2, delay: 5, dur: 14 },
  { x: 68, y: 12, size: 1, delay: 7, dur: 13 },
  { x: 76, y: 48, size: 1.5, delay: 0.5, dur: 12 },
  { x: 84, y: 78, size: 2, delay: 2.5, dur: 16 },
  { x: 90, y: 36, size: 1, delay: 4.5, dur: 15 },
  { x: 96, y: 90, size: 1.5, delay: 6.5, dur: 11 },
];

export default function WelcomeTour({ open, onClose }) {
  const navigate = useNavigate();
  const t = useT();

  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    if (open) setPageIndex(0);
  }, [open]);

  const close = () => {
    markTourSeen();
    onClose?.();
  };

  const navigateToFeature = (feature) => {
    markTourSeen();
    if (feature.step) setTourStep(feature.step);
    onClose?.();
    navigate(feature.path);
  };

  // Synthetic-keydown handoff for global overlays (palette, cheat
  // sheet). Modal close transition + focus-trap teardown completes in
  // ≈350 ms; dispatch after that so the overlay's own listener can
  // actually open the surface.
  const triggerSynthetic = (init) => {
    markTourSeen();
    onClose?.();
    setTimeout(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { ...init, bubbles: true }),
      );
    }, 350);
  };

  const onFeatureClick = (feature) => {
    if (feature.synthetic) {
      triggerSynthetic(feature.synthetic);
      return;
    }
    navigateToFeature(feature);
  };

  const goNext = () => setPageIndex((p) => Math.min(p + 1, TOTAL_PAGES - 1));
  const goPrev = () => setPageIndex((p) => Math.max(p - 1, 0));

  const isIntro = pageIndex === INTRO_INDEX;
  const isOutro = pageIndex === OUTRO_INDEX;
  const currentCategory =
    !isIntro && !isOutro ? CATEGORIES[pageIndex - 1] : null;

  return (
    <Modal
      popupOpen={open}
      handleClose={close}
      additionalClasses="w-full max-w-3xl"
    >
      <div className="relative overflow-hidden rounded-3xl border border-gold/25 bg-ink-1 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] p-6 md:p-10">
        {/* ─── Atmosphere layer 1 · radial blooms ──────────────────
            Two large blurred discs anchor the page diagonally. Gold
            top-left for warmth, hanko bottom-right for the brand
            pulse. They're under -z-10 so they sit behind the noise +
            particles + content layers. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 -top-32 -z-10 h-80 w-80 rounded-full bg-gold/10 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -bottom-24 -z-10 h-72 w-72 rounded-full bg-hanko/15 blur-3xl"
        />

        {/* ─── Atmosphere layer 2 · washi noise grain ──────────────
            SVG fractal-noise filter rasterised once, tiled with
            opacity 0.05. Adds tactile paper feel without ballooning
            the modal asset cost. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04] mix-blend-soft-light"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />

        {/* ─── Atmosphere layer 3 · floating ink particles ────────
            12 small dots drifting along bezier-ish paths via the
            tour-particle-drift keyframe. Each carries a unique delay
            + duration via inline style so they don't pulse in unison.
            Hidden via CSS at the keyframe level when the user has
            requested reduced motion (the keyframe leaves opacity
            permanently 0 in that case). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="tour-particle absolute rounded-full bg-hanko/35"
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

        {/* ─── Atmosphere layer 4 · corner ornaments ──────────────
            Four thin SVG corner brackets at the modal corners — the
            visual vocabulary of an antique printed catalogue's page
            frame. Inset 10 px so they don't touch the rounded-3xl
            corner. */}
        <CornerBrackets />

        {/* ─── Slide track ────────────────────────────────────────
            Pages live on a single horizontal flex track shifted by
            translateX. The OUTGOING page also gets a soft fade +
            blur via the inner key prop on the active page so the
            stamp animation on the new page reads as the new focal
            point. */}
        <div className="relative overflow-hidden">
          <div
            className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{ transform: `translateX(-${pageIndex * 100}%)` }}
          >
            {/* Each page wrapper gets its OWN `overflow-hidden`. With
                the slide track laying 6 pages side-by-side, any
                content that bleeds past a page's content edge (via
                blur halos, big drop-shadows, etc.) would otherwise
                creep into the neighbour's visible area when that
                neighbour is the active page. Per-page clipping keeps
                each page in its own world.

                `pageKey` flips between the page's actual index (when
                active) and -1 (when off-screen). The kanji elements
                consume this in their `key` prop, so each transition
                between active and inactive remounts the kanji and
                replays the stamp-press animation. */}
            <div className="w-full shrink-0 overflow-hidden px-1">
              <IntroPage
                active={isIntro}
                pageKey={isIntro ? pageIndex : -1}
                t={t}
              />
            </div>
            {CATEGORIES.map((category, i) => (
              <div
                key={category.id}
                className="w-full shrink-0 overflow-hidden px-1"
              >
                <CategoryPage
                  category={category}
                  active={!isIntro && !isOutro && currentCategory?.id === category.id}
                  pageKey={pageIndex === i + 1 ? pageIndex : -1}
                  onFeatureClick={onFeatureClick}
                  t={t}
                />
              </div>
            ))}
            <div className="w-full shrink-0 overflow-hidden px-1">
              <OutroPage
                active={isOutro}
                pageKey={isOutro ? pageIndex : -1}
                onClose={close}
                t={t}
              />
            </div>
          </div>
        </div>

        {/* ─── Sumi progress trail ────────────────────────────────
            Replaces the old dots. A dotted line spans the width;
            a hanko gradient fills it up to the active page; a
            small 印 character travels along the fill edge. */}
        <ProgressTrail current={pageIndex} total={TOTAL_PAGES} />

        {/* ─── Footer nav ─────────────────────────────────────────
            Same three-button grammar as before. Vertical kanji
            decorations (前 next to back, 次 next to next) frame the
            buttons typographically. */}
        <Footer
          isIntro={isIntro}
          isOutro={isOutro}
          onBack={goPrev}
          onNext={goNext}
          onSkipSection={goNext}
          onClose={close}
          t={t}
        />
      </div>
    </Modal>
  );
}

// ─── Intro page ────────────────────────────────────────────────────

function IntroPage({ active, pageKey, t }) {
  return (
    <div className="relative">
      {/* The intro's own giant kanji — uses 始 (hajime, "begin") and
          re-fires its stamp animation each time the modal reopens via
          the `pageKey` prop on the outer wrapper.

          Per-page `overflow-hidden` on the slide-track wrapper means
          we don't try to bleed past the page edges with negative
          margins anymore — the drama comes from sheer SIZE of the
          glyph + the stamp-press easing, not from off-frame
          positioning. Cleaner geometry, no neighbour-leak bug. */}
      <div className="relative grid gap-4 sm:grid-cols-[auto_1fr] sm:gap-8">
        <div className="relative">
          <span
            key={`intro-kanji-${pageKey}`}
            aria-hidden="true"
            className={`relative block font-jp font-black leading-[0.85] text-[7rem] sm:text-[12rem] text-hanko-gradient ${
              active ? "tour-stamp-press-target" : ""
            }`}
            style={{
              filter: "drop-shadow(0 4px 24px var(--hanko-glow))",
            }}
          >
            始
          </span>
          {active && (
            <span
              key={`intro-bloom-${pageKey}`}
              aria-hidden="true"
              className="tour-stamp-press-bloom pointer-events-none absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hanko/40 blur-2xl sm:h-48 sm:w-48"
            />
          )}
        </div>

        <div className="pt-2 sm:pt-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
            {t("tour.kicker")} · 始
          </p>
          <h2
            data-autofocus
            tabIndex={-1}
            className="mt-3 font-display text-3xl font-light italic leading-[1.05] tracking-tight text-washi md:text-5xl"
          >
            {t("tour.headingPre")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("tour.headingAccent")}
            </span>
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-washi-muted md:text-base">
            {t("tour.intro")}
          </p>
        </div>
      </div>

      {/* Decorative gold ribbon — separates intro copy from the
          chapter preview grid below. Three-stop linear gradient that
          peaks gold at the centre. */}
      <div
        aria-hidden="true"
        className="my-7 h-px w-full bg-gradient-to-r from-transparent via-gold/40 to-transparent md:my-10"
      />

      {/* 目次 · Chapter preview — same content as before but compact
          + with a per-card stagger fade-up. The kanji here are shown
          at smaller scale; the BIG stamp treatment is reserved for
          the chapter pages themselves. */}
      <ol className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        {CATEGORIES.map((cat, i) => (
          <li
            key={cat.id}
            className="group relative overflow-hidden rounded-xl border border-border bg-ink-2/40 p-3 transition hover:border-hanko/40 hover:bg-ink-2/70 animate-fade-up"
            style={{ animationDelay: `${active ? 320 + i * 80 : 0}ms` }}
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-washi-dim">
              第{["一", "二", "三", "四"][i]}章
            </span>
            <p className="mt-2 font-jp text-3xl font-bold leading-none text-hanko-gradient">
              {cat.kanji}
            </p>
            <p className="mt-1 font-display text-xs italic text-washi-dim">
              {cat.romaji}
            </p>
            <p className="mt-2 font-display text-xs font-semibold leading-tight text-washi">
              {t(cat.titleKey)}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Category page ─────────────────────────────────────────────────

function CategoryPage({ category, active, pageKey, onFeatureClick, t }) {
  return (
    <div className="relative">
      {/* ─── Header — kanji left, title right ─────────────────────
          The grid's first column shrinks to the kanji's natural
          width (`auto`), the second column takes the remaining
          space. The drama comes from SIZE (text-[14rem]) + the
          stamp-press animation, not from off-frame bleed — bleeding
          via negative margins would leak into adjacent slide-track
          pages and was causing visible artefacts on the right edge
          of the modal. */}
      <div className="relative grid gap-4 sm:grid-cols-[auto_1fr] sm:gap-10">
        <div className="relative">
          {/* `key` triggers a CSS animation re-fire each time the
              page becomes active, since changing the key remounts
              the element and the keyframe replays from frame 0. */}
          <span
            key={`cat-kanji-${category.id}-${pageKey}`}
            aria-hidden="true"
            className={`relative block font-jp font-black leading-[0.82] text-[8rem] sm:text-[13rem] text-hanko-gradient ${
              active ? "tour-stamp-press-target" : ""
            }`}
            style={{
              filter: "drop-shadow(0 6px 32px var(--hanko-glow))",
            }}
          >
            {category.kanji}
          </span>
          {active && (
            <span
              key={`cat-bloom-${category.id}-${pageKey}`}
              aria-hidden="true"
              className="tour-stamp-press-bloom pointer-events-none absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hanko/45 blur-3xl sm:h-56 sm:w-56"
            />
          )}
        </div>

        <div className="pt-2 sm:pt-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
            {t("tour.chapterLabel")} · {category.romaji}
          </p>
          <h2 className="mt-3 font-display text-3xl font-light italic leading-tight tracking-tight text-washi md:text-4xl">
            {t(category.titleKey)}
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-washi-muted">
            {t(category.bodyKey)}
          </p>
        </div>
      </div>

      {/* Brushstroke divider — the same SVG shape used on the
          Settings page's chapter headings, repeated here so the two
          surfaces share a typographic vocabulary. */}
      <Brushstroke className="mt-6 mb-6 md:mt-9 md:mb-8" />

      {/* Feature cards — staggered tilts via the .tour-card-tilt-*
          classes. The active flag controls the entry stagger so the
          animation only fires when the page is in view. */}
      <div className="grid gap-4 md:grid-cols-3 md:gap-3.5">
        {category.features.map((feature, i) => (
          <FeatureCard
            key={feature.id}
            feature={feature}
            tiltClass={CARD_TILTS[i % CARD_TILTS.length]}
            active={active}
            delay={400 + i * 110}
            onClick={() => onFeatureClick(feature)}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Feature card ──────────────────────────────────────────────────

function FeatureCard({ feature, tiltClass, active, delay, onClick, t }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-col items-start gap-3 rounded-2xl border border-border/80 bg-gradient-to-br from-ink-2/80 via-ink-2/60 to-ink-1/70 p-5 pt-7 text-left shadow-[0_12px_28px_-18px_rgba(0,0,0,0.7)] hover:border-hanko/55 hover:shadow-[0_16px_36px_-16px_var(--hanko-glow)] focus-visible:border-hanko focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hanko/40 tour-card-fold ${tiltClass} ${
        active ? "animate-fade-up" : ""
      }`}
      style={active ? { animationDelay: `${delay}ms` } : undefined}
    >
      {/* 印 · Hanko-style corner stamp. Sits half-outside the card
          via negative offsets so it reads as a real stamp pressed
          across the card's edge, not a UI badge inside it. */}
      <span
        aria-hidden="true"
        className="tour-stamp-corner absolute -left-2 -top-2 grid h-9 w-9 place-items-center rounded-full font-jp text-base font-bold text-washi"
        style={{ transform: "rotate(-9deg)" }}
      >
        {feature.kanji}
      </span>

      {/* Romaji breadcrumb under the title — small, dim, italic. */}
      <p className="font-display text-[11px] italic text-washi-dim">
        {feature.romaji}
      </p>

      <h3 className="font-display text-base font-semibold leading-tight text-washi md:text-lg">
        {t(feature.titleKey)}
      </h3>

      <p className="text-xs leading-relaxed text-washi-muted">
        {t(feature.bodyKey)}
      </p>

      {/* CTA arrow — uppercase mono with a sliding underline that
          fills on hover. The arrow itself nudges right on hover via
          the group-hover translate. */}
      <span className="mt-auto inline-flex items-center gap-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-hanko-bright transition-transform group-hover:translate-x-1">
        {t(feature.ctaKey)}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </span>
    </button>
  );
}

// ─── Outro page ────────────────────────────────────────────────────

function OutroPage({ active, pageKey, onClose, t }) {
  return (
    <div className="relative">
      <div className="relative grid gap-4 sm:grid-cols-[auto_1fr] sm:gap-10">
        <div className="relative">
          <span
            key={`outro-kanji-${pageKey}`}
            aria-hidden="true"
            className={`relative block font-jp font-black leading-[0.82] text-[8rem] sm:text-[13rem] text-hanko-gradient ${
              active ? "tour-stamp-press-target" : ""
            }`}
            style={{
              filter: "drop-shadow(0 6px 32px var(--hanko-glow))",
            }}
          >
            完
          </span>
          {active && (
            <span
              key={`outro-bloom-${pageKey}`}
              aria-hidden="true"
              className="tour-stamp-press-bloom pointer-events-none absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hanko/45 blur-3xl sm:h-56 sm:w-56"
            />
          )}
        </div>

        <div className="pt-2 sm:pt-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
            {t("tour.outroKicker")} · 完
          </p>
          <h2 className="mt-3 font-display text-3xl font-light italic leading-tight tracking-tight text-washi md:text-4xl">
            {t("tour.outroTitle")}
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-washi-muted">
            {t("tour.outroBody")}
          </p>
        </div>
      </div>

      <Brushstroke className="mt-7 mb-7 md:mt-10 md:mb-9" />

      <div className="flex flex-wrap items-center gap-2.5 md:gap-3">
        <Link
          to="/glossary"
          onClick={onClose}
          className="group inline-flex items-center gap-2 rounded-full border border-border bg-ink-2/40 px-4 py-2 text-sm font-semibold text-washi-muted transition hover:border-hanko/40 hover:text-washi"
        >
          <span
            aria-hidden="true"
            className="font-jp text-base font-bold leading-none text-washi-dim transition-colors group-hover:text-hanko"
          >
            字典
          </span>
          {t("tour.outroGlossary")}
        </Link>
        <Link
          to="/settings"
          onClick={onClose}
          className="group inline-flex items-center gap-2 rounded-full border border-border bg-ink-2/40 px-4 py-2 text-sm font-semibold text-washi-muted transition hover:border-hanko/40 hover:text-washi"
        >
          <span
            aria-hidden="true"
            className="font-jp text-base font-bold leading-none text-washi-dim transition-colors group-hover:text-hanko"
          >
            設
          </span>
          {t("tour.outroSettings")}
        </Link>
      </div>

      <p className="mt-5 font-display text-[11px] italic text-washi-dim">
        {t("tour.replayHint")}
      </p>
    </div>
  );
}

// ─── Footer nav ────────────────────────────────────────────────────

function Footer({ isIntro, isOutro, onBack, onNext, onSkipSection, onClose, t }) {
  return (
    <div className="mt-7 flex items-center justify-between gap-3 border-t border-border/40 pt-5 md:mt-9">
      {!isIntro ? (
        <button
          type="button"
          onClick={onBack}
          className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim transition hover:text-washi"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3 transition-transform group-hover:-translate-x-0.5"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span className="hidden sm:inline">{t("tour.prev")}</span>
          <span
            aria-hidden="true"
            className="font-jp text-sm font-bold leading-none text-washi-dim/60 transition-colors group-hover:text-hanko/80"
          >
            前
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim transition hover:text-washi"
        >
          {t("tour.skip")}
        </button>
      )}

      <div className="flex items-center gap-2 sm:gap-3">
        {!isIntro && !isOutro && (
          <button
            type="button"
            onClick={onSkipSection}
            className="group inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-washi-dim transition hover:text-washi sm:text-[10px]"
          >
            <span className="border-b border-dotted border-current pb-0.5">
              {t("tour.skipSection")}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={isOutro ? onClose : onNext}
          className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-br from-hanko-deep to-hanko px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-washi shadow-[0_4px_18px_var(--hanko-glow)] transition hover:brightness-110 active:scale-95 sm:px-5"
        >
          {/* Decorative kanji on the right of the next CTA — adds a
              vertical typographic anchor to the button without taking
              up real estate. */}
          {!isOutro && (
            <span
              aria-hidden="true"
              className="font-jp text-sm font-bold leading-none opacity-80"
            >
              次
            </span>
          )}
          {isIntro
            ? t("tour.beginCta")
            : isOutro
              ? t("tour.outroDone")
              : t("tour.next")}
          {!isOutro && (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Sumi-ink progress trail ───────────────────────────────────────

function ProgressTrail({ current, total }) {
  // Position the 印 marker along the trail. `current === 0` (intro)
  // sits at 0%, `current === total - 1` (outro, last) sits at 100%.
  // We clamp so the marker never overshoots when the index is
  // momentarily out of range during transitions.
  const pct = total > 1 ? Math.min(100, (current / (total - 1)) * 100) : 0;

  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current + 1}
      className="relative mt-4 mb-2 flex items-center gap-3"
    >
      {/* Trail track — dotted line spanning the full width. The
          filled portion sits ABOVE it as a separate gradient layer
          so the dotted background still shows through the un-drawn
          portion. */}
      <div className="relative h-px flex-1">
        <div className="tour-progress-track absolute inset-0" />
        <div
          className="tour-progress-fill absolute left-0 top-0 h-px"
          style={{ width: `${pct}%` }}
        />
        {/* The 印 marker, glued to the right edge of the fill. -8 px
            offset to centre the glyph on the line. */}
        <span
          aria-hidden="true"
          className="absolute top-1/2 -translate-y-1/2 font-jp text-[10px] font-bold leading-none text-hanko-bright transition-[left] duration-500 ease-out"
          style={{
            left: `calc(${pct}% - 4px)`,
            textShadow: "0 0 6px var(--hanko-glow)",
          }}
        >
          印
        </span>
      </div>

      {/* Numeric counter — small, mono, dim. Reads "01 / 06" so the
          user always knows the journey length. */}
      <span className="font-mono text-[9px] uppercase tracking-[0.22em] tabular-nums text-washi-dim">
        {String(current + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
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
      className={`h-2 w-full ${className}`}
    >
      <defs>
        <linearGradient id="tour-brush-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--hanko)" stopOpacity="0" />
          <stop offset="14%" stopColor="var(--hanko)" stopOpacity="0.7" />
          <stop offset="50%" stopColor="var(--hanko-bright)" stopOpacity="1" />
          <stop offset="86%" stopColor="var(--hanko)" stopOpacity="0.7" />
          <stop offset="100%" stopColor="var(--hanko)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M2,4 Q200,1 400,4 T800,5 T1198,3"
        stroke="url(#tour-brush-grad)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

// ─── Corner brackets ───────────────────────────────────────────────

function CornerBrackets() {
  // Four small SVG "L" brackets pinned to the modal's inner corners.
  // Same vocabulary as old printed catalogue page frames. Inline
  // colors so the SVG can pick up the gold tone without a stylesheet
  // detour.
  const stroke = "var(--gold)";
  const opacity = 0.4;
  const size = 14;
  const armLen = 10;
  const cornerStyle = {
    stroke,
    strokeOpacity: opacity,
    strokeWidth: 1,
    strokeLinecap: "round",
    fill: "none",
  };
  return (
    <>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-3 -z-10 md:left-5 md:top-5"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <path d={`M0,${armLen} L0,0 L${armLen},0`} style={cornerStyle} />
      </svg>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-3 -z-10 md:right-5 md:top-5"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <path
          d={`M${size - armLen},0 L${size},0 L${size},${armLen}`}
          style={cornerStyle}
        />
      </svg>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3 left-3 -z-10 md:bottom-5 md:left-5"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <path
          d={`M0,${size - armLen} L0,${size} L${armLen},${size}`}
          style={cornerStyle}
        />
      </svg>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3 right-3 -z-10 md:bottom-5 md:right-5"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <path
          d={`M${size - armLen},${size} L${size},${size} L${size},${size - armLen}`}
          style={cornerStyle}
        />
      </svg>
    </>
  );
}
