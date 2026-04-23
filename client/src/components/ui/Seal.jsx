import { useT } from "@/i18n/index.jsx";
import { TIERS } from "@/lib/sealsCatalog.js";

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
export default function Seal({ code, kanji, earned, earnedAt, newly, tier = 2 }) {
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

  return (
    <div
      className="group flex flex-col items-center text-center"
      role="listitem"
    >
      {/* Stamp square */}
      <div className="relative">
        <div
          className={`seal-stamp relative grid h-24 w-24 place-items-center rounded-md lg:h-28 lg:w-28 seal-tier-${tierName} ${
            earned ? "seal-earned" : "seal-locked"
          } ${newly ? "animate-seal-ceremony" : ""}`}
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
