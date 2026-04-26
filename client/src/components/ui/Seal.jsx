import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/index.jsx";
import { TIERS } from "@/lib/sealsCatalog.js";

/**
 * 儀式 · Per-tier glow tone for the spotlight stage. The splash and
 * the rising sumi flecks pick this colour up via the
 * `--seal-spotlight-glow` CSS variable we set inline below — so the
 * halo around a moegi seal reads moegi-green, a kin seal reads gold,
 * etc. The legacy hard-coded `var(--hanko)` was a bug.
 *
 * Shikkoku (lacquer black) maps to gold rather than ink: the legendary
 * tier carries gold inlay on the chip itself, and a black halo would
 * vanish against the dimmer overlay.
 */
const TIER_GLOW = {
  sumi: "oklch(0.78 0.015 70)",
  hanko: "var(--hanko)",
  moegi: "var(--moegi)",
  kin: "var(--gold)",
  shikkoku: "var(--gold)",
};

/**
 * Ceremonial hanko seal component for the 印鑑帳 journal.
 *
 * Two states, each themed by tier:
 *  • earned — full colored stamp per tier (sumi/hanko/moegi/kin/shikkoku),
 *    slight negative tilt, warm glow, date below. `newly` triggers an
 *    exaggerated ceremony animation (scale-overshoot + hanko glow halo).
 *  • locked — dashed outline uniform across tiers, but the kanji carries
 *    its future tier's color at ~15% opacity — the carnet becomes a
 *    "treasure map" where you can read what each empty slot will become.
 *
 * Dimensions are fixed (h-24 w-24 mobile, lg:h-28 lg:w-28) so the grid
 * reads as a uniform bank of stamps; tier colors + rotation provide all
 * the variation.
 */
export default function Seal({
  code,
  kanji,
  earned,
  earnedAt,
  newly,
  tier = 2,
  // 儀式 · When `playing`, this seal is the active focus of the
  // ceremony loop. The grid wrapper raises above the dimmer overlay,
  // an ink-splash + sumi particle stage decorates the cell, and the
  // stamp animation replays with extra punch (animate-seal-spotlight
  // overrides the regular newly path).
  playing = false,
  // 儀式 · Set by SealsPage while the ceremony loop is in flight,
  // for ALL seals on the page. While true, we hand off all animation
  // duty to the spotlight branch: a seal that just sat in spotlight
  // won't fall back into `animate-seal-ceremony` when `playing` flips
  // off (which would otherwise trigger a phantom re-bump because the
  // browser sees a "new" animation class arrive on the element). The
  // unflipped state is intentional: outside the ceremony loop the
  // page reverts to its idle-discovery animation grammar.
  ceremonyManaged = false,
}) {
  const t = useT();
  const label = t(`seals.codes.${code}.label`);
  const description = t(`seals.codes.${code}.description`);
  const tierName = TIERS[tier]?.name ?? "hanko";
  const tierLabel = TIERS[tier]?.label ?? "印";

  // Stable per-seal tilt angle — derived from the code so each seal keeps
  // the same tilt across renders (no jitter), but the bank isn't uniform.
  const tilt = earned ? tiltFor(code) : 0;

  // Tier localised to the user — shown on hover/focus so the legend is
  // always decipherable without a separate key.
  const tierDescription = t(`seals.tiers.${tierName}`);

  // Stable particle layout per seal — derived from the code so the
  // splash placement doesn't reshuffle on re-render. Memoised on
  // `(playing, code)` so the rest of the page's state churn doesn't
  // re-roll an array of 16 objects on every Seal render. `null` when
  // not playing keeps the JSX guard below cheap.
  const particles = useMemo(
    () => (playing ? makeParticles(code) : null),
    [playing, code],
  );
  const glowColor = TIER_GLOW[tierName] ?? "var(--hanko)";

  // 儀式 · `playPass` increments only when `playing` flips ON,
  // never when it flips OFF. The seal's key derives from this counter
  // so React replays the spotlight animation each time we enter focus
  // — but does NOT re-mount when we leave focus, which used to
  // accidentally retrigger `animate-seal-ceremony` on the previous
  // seal at the exact moment the next one was lighting up.
  const [playPass, setPlayPass] = useState(0);
  useEffect(() => {
    if (playing) setPlayPass((n) => n + 1);
  }, [playing]);

  return (
    <div
      className={`group flex flex-col items-center text-center ${
        playing ? "seal-spotlight" : ""
      }`}
      role="listitem"
    >
      {/* Stamp square */}
      <div className="relative">
        {/* 儀式 · Stage decoration — only mounted while this seal is
            the active focus. Splash + particles are absolutely
            positioned around the stamp cell so they spill outside
            the grid track without affecting layout. The container's
            inline `--seal-spotlight-glow` propagates down to the
            splash and the flecks so each tier reads in its own ink. */}
        {playing && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-16 -inset-y-12 -z-10 grid place-items-center"
            style={{ "--seal-spotlight-glow": glowColor }}
          >
            <div className="seal-spotlight-splash" />
            <div className="absolute inset-0 grid place-items-center">
              {particles?.map((p, i) => (
                <span
                  key={i}
                  className="seal-spotlight-particle absolute rounded-full"
                  style={{
                    left: `${p.x}%`,
                    bottom: "30%",
                    width: `${p.size}px`,
                    height: `${p.size}px`,
                    animationDelay: `${p.delay}ms`,
                    animationDuration: `${p.duration}ms`,
                    background: "var(--seal-spotlight-glow)",
                    opacity: 0.75,
                    "--rise": `${p.rise}px`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div
          // Re-mount only on the rising edge of `playing` (entering
          // the spotlight), driven by playPass which never decrements.
          // Leaving the spotlight keeps the key stable, so the seal
          // doesn't re-trigger its `animate-seal-ceremony` reveal at
          // the exact moment the next seal is lighting up.
          key={`${code}-${playPass}`}
          className={`seal-stamp relative grid h-24 w-24 place-items-center rounded-md lg:h-28 lg:w-28 seal-tier-${tierName} ${
            earned ? "seal-earned" : "seal-locked"
          } ${(() => {
            // Only the spotlight branch is allowed to animate while the
            // ceremony loop is running. Once a seal leaves the spotlight
            // we deliberately apply NO animation class — neither the
            // browser nor React will fire a fresh keyframe pass, so the
            // previous seal sits still while the next one lights up.
            if (playing) return "animate-seal-spotlight";
            if (newly && !ceremonyManaged) return "animate-seal-ceremony";
            return "";
          })()}`}
          style={{
            transform: `rotate(${tilt}deg)`,
          }}
          title={`${description} · ${tierDescription}`}
          aria-label={`${label} — ${description}${
            earned && earnedAt
              ? ` (${formatDate(earnedAt)})`
              : ` (${t("seals.lockedHint")})`
          } · ${tierDescription}`}
        >
          <span className="font-jp text-[44px] leading-none lg:text-[52px]">
            {kanji}
          </span>

          {/* Inner paper texture — very subtle noise */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-md opacity-[0.08] mix-blend-overlay"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
            }}
          />

          {/* Tier indicator — tiny kanji in the top-right corner, always
              visible (earned or locked). Reads as "what ink this seal
              is carved with". Shikkoku and kin get a little glint. */}
          <span
            aria-hidden="true"
            className={`seal-tier-tag pointer-events-none absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full font-jp text-[9px] leading-none`}
          >
            {tierLabel}
          </span>

          {/* Kin/Shikkoku diagonal shine — a very slow sweep every 6s */}
          {earned && (tier === 4 || tier === 5) && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-md"
            >
              <div className="seal-shine absolute -inset-full" />
            </div>
          )}
        </div>

        {/* Ceremonial glow halo behind the stamp when newly earned —
            tinted to match the tier so the ceremony reads tonally right. */}
        {newly && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 -z-10 animate-seal-glow rounded-md blur-xl seal-glow-${tierName}`}
          />
        )}
      </div>

      {/* Caption */}
      <p
        className={`mt-3 font-display text-[13px] leading-tight ${
          earned ? "italic text-washi" : "text-washi-dim"
        }`}
      >
        {label}
      </p>
      {earned && earnedAt ? (
        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-washi-dim">
          {formatDate(earnedAt)}
        </p>
      ) : (
        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-washi-dim/60">
          {t("seals.lockedHint")}
        </p>
      )}
    </div>
  );
}

/**
 * Hash-based deterministic tilt. Each seal gets a stable angle from its
 * code so the bank looks hand-stamped rather than uniform.
 * Range: -4.2° to -0.6° (always negative — seals lean left, like real
 * over-the-shoulder hand stamps).
 */
function tiltFor(code) {
  let h = 0;
  for (let i = 0; i < code.length; i++) {
    h = (h * 31 + code.charCodeAt(i)) >>> 0;
  }
  // Map hash to [-4.2, -0.6]
  const span = 3.6;
  const normalized = (h % 100) / 100; // 0..1
  return -(0.6 + normalized * span);
}

/**
 * 儀式 · Deterministic per-seal particle layout for the spotlight
 * stage. Same hash → same flecks every time this seal lights up, so a
 * user who unlocks the same code twice (rare but possible after a
 * reset) gets a continuous identity rather than reshuffled noise.
 */
function makeParticles(seedCode) {
  let h = 0;
  for (let i = 0; i < seedCode.length; i++) {
    h = (h * 31 + seedCode.charCodeAt(i)) >>> 0;
  }
  const rand = (() => {
    let s = h || 1;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
  })();
  return Array.from({ length: 6 }, () => ({
    x: 30 + rand() * 40,
    size: 3 + rand() * 5,
    delay: 200 + rand() * 600,
    duration: 1500 + rand() * 700,
    rise: 80 + rand() * 70,
  }));
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
