import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Seal from "./ui/Seal.jsx";
import { SEAL_CATALOG } from "@/lib/sealsCatalog.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 儀式 · gishiki — the ceremony shown the moment one or more seals
 * are newly earned.
 *
 * A full-screen ritual: dim overlay, central ink splash, the new
 * seal(s) stamping in with overshoot, ascending sumi particles, a
 * crescendo haptic on mobile. Auto-dismisses after a held beat
 * (long enough for the user to register the unlock, short enough
 * not to overstay) or on tap / Escape.
 *
 * Multiple seals share a single ceremony — they fan out from the
 * splash centre with staggered delays. We don't carousel through
 * them: one big "wow" beats N small ones.
 *
 * The ceremony fires *only when newlyGranted just arrived non-empty*
 * for the very first time at this URL. Closing it persists nothing —
 * the parent's `newly_granted` slice already lives in transient
 * state, and the hook strips it from Dexie before caching.
 */
const HOLD_MS = 4200; // total ceremony duration (auto-dismiss)

export default function SealCeremony({ newlyCodes, onClose }) {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const closeTimerRef = useRef(null);

  // Resolve the codes against the catalog so the ceremony renders
  // the same kanji + tier metadata the SealsPage grid uses.
  const seals = (newlyCodes ?? [])
    .map((code) => SEAL_CATALOG.find((s) => s.code === code))
    .filter(Boolean);

  // Auto-dismiss + escape handling. Both paths flip `leaving` so the
  // exit animation plays before unmount.
  const startClose = () => {
    if (leaving) return;
    setLeaving(true);
    // Match the CSS exit animation duration.
    closeTimerRef.current = window.setTimeout(() => {
      onClose?.();
    }, 280);
  };

  useEffect(() => {
    if (!seals.length) return;
    // 触覚 — short crescendo: three taps growing in length feel like
    // a stamp coming down. navigator.vibrate is silently no-op'd on
    // iOS/desktop, so the call is safe everywhere.
    try {
      navigator.vibrate?.([20, 60, 90]);
    } catch {
      /* vibration disabled / sandboxed — ignore */
    }

    const t1 = window.setTimeout(startClose, HOLD_MS);
    const onKey = (e) => {
      if (e.key === "Escape") startClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while the ceremony is on screen so a
    // touchscreen tap doesn't accidentally scroll the page below.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(t1);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seals.length]);

  if (!seals.length) return null;

  // Stable particle layout per ceremony — derive offsets from the
  // first seal's code so the ascending sumi flecks don't reshuffle
  // on every render of the parent.
  const particles = makeParticles(seals[0].code);

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("seals.ceremonyAria")}
      onClick={startClose}
      className={`fixed inset-0 z-[2147483640] flex flex-col items-center justify-center overflow-hidden bg-ink-0/85 backdrop-blur-md p-6 ${
        leaving ? "animate-fade-out" : "animate-fade-in"
      }`}
    >
      {/* 墨 · sumi-ink splash — a soft organic blob behind the seal,
          radial-gradient hanko in the centre fading to nothing. Lives
          on its own pseudo-layer (z-0) so the seal grid (z-10) reads
          on top. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 grid place-items-center"
      >
        <div className="seal-ink-splash" />
      </div>

      {/* Ascending ink flecks — fade-up + drift from below the seal.
          Six points, each with its own delay/duration/offset so the
          rise feels organic rather than a uniform fountain. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 grid place-items-center"
      >
        <div className="relative h-72 w-72">
          {particles.map((p, i) => (
            <span
              key={i}
              className="seal-particle absolute rounded-full bg-hanko/70"
              style={{
                left: `${p.x}%`,
                bottom: "0%",
                width: `${p.size}px`,
                height: `${p.size}px`,
                animationDelay: `${p.delay}ms`,
                animationDuration: `${p.duration}ms`,
                "--rise": `${p.rise}px`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Editorial preamble — supertitle + heading mirror the rest
          of the project's pattern (`KICKER · 漢字`). */}
      <div
        className={`relative z-10 mb-8 text-center ${
          leaving ? "animate-fade-out" : "animate-fade-up"
        }`}
        style={{ animationDelay: leaving ? "0ms" : "200ms" }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-hanko-bright">
          {t("seals.ceremonyKicker")} · 印鑑帳
        </p>
        <h2 className="mt-3 font-display text-3xl font-light italic leading-none tracking-tight text-washi md:text-5xl">
          {seals.length === 1
            ? t("seals.ceremonyHeadingOne")
            : t("seals.ceremonyHeadingMany", { n: seals.length })}
        </h2>
      </div>

      {/* The seal(s) themselves — center-stage, staggered fade-in
          riding the existing seal-ceremony scale-overshoot. Limit
          to a 3-column row so a multi-grant doesn't sprawl. */}
      <div
        className={`relative z-10 grid max-w-[80vw] grid-flow-col auto-cols-min gap-6 sm:gap-8 ${
          leaving ? "animate-fade-out" : ""
        }`}
      >
        {seals.slice(0, 3).map((s, i) => (
          <div
            key={s.code}
            style={{
              animation: `seal-ceremony-mount 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) ${300 + i * 180}ms both`,
            }}
          >
            <Seal
              code={s.code}
              kanji={s.kanji}
              earned={true}
              earnedAt={new Date().toISOString()}
              newly={true}
              tier={s.tier}
            />
          </div>
        ))}
      </div>
      {seals.length > 3 && (
        <p className="relative z-10 mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-washi-muted">
          {t("seals.ceremonyMore", { n: seals.length - 3 })}
        </p>
      )}

      {/* Dismiss hint — quiet, only appears once the ceremony has
          settled so it doesn't compete with the seal mount. */}
      <p
        className="relative z-10 mt-10 font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim"
        style={{
          animation: leaving
            ? "fade-out 0.2s ease both"
            : "fade-up 0.5s 1500ms ease both",
        }}
      >
        {t("seals.ceremonyDismiss")}
      </p>
    </div>
  );

  return createPortal(overlay, document.body);
}

/**
 * Deterministic particle layout. Each ceremony reads "the same" but
 * with enough variance that the eye doesn't pick out a fixed pattern.
 * Six points: 2 close + 4 spread, varied size / delay / rise distance.
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
    x: 30 + rand() * 40, // 30..70 % of the 18rem container width
    size: 3 + rand() * 5, // 3..8 px sumi flecks
    delay: 200 + rand() * 700,
    duration: 1400 + rand() * 800,
    rise: 120 + rand() * 80, // 120..200 px upward travel
  }));
}
