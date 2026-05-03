/* eslint-disable react-refresh/only-export-components --
 * Co-locating the `loanCoverFilter` helper with the LoanStamp
 * component keeps the loan-state visual contract in a single file
 * (the helper applies the matching cover desaturation; the
 * component renders the matching stamp). The Fast-Refresh rule
 * is dev-only — at runtime the mixed exports behave the same.
 */
import { useMemo } from "react";
import { useT } from "@/i18n/index.jsx";

/**
 * 預 Azuke · Loan stamp overlay for volume covers.
 *
 * The visual metaphor — a 19th-century rubber stamp pressed across
 * the cover of a borrowed library book. The stamp is a circular
 * hanko-red impression with the status kanji centered, two thin
 * "ring" curves above and below (typewriter-stamp aesthetic), and
 * a tiny inscription of the borrower's initial pressed beneath.
 *
 * Colour-coded by lifecycle state:
 *   • overdue  → hanko-red, pulse-glow (urgent)
 *   • due_soon → gold (within 7d)
 *   • active   → hanko-red (out, no urgency)
 *   • open     → washi-dim (no due date set)
 *
 * Two density variants:
 *   • size="lg" → 60% of slot, rotated -22°, full kanji + initial.
 *     Used on the regular Volume card cover button.
 *   • size="sm" → corner-anchored micro-stamp. Used on the dense
 *     VolumeShelfTile where the cover is ~50px wide.
 *
 * The component renders nothing (returns null) when `loanedTo`
 * is null/empty — call sites can mount it unconditionally.
 *
 * Pair with the `LoanCoverFilter` helper below to apply the
 * matching desaturation filter on the cover image; the two
 * together communicate "owned but absent" without hiding the
 * underlying artwork.
 */
export default function LoanStamp({
  loanedTo,
  loanDueAt = null,
  size = "lg",
}) {
  const t = useT();
  const status = classify(loanDueAt);
  const initial = useMemo(() => {
    if (!loanedTo) return "";
    const trimmed = String(loanedTo).trim();
    if (!trimmed) return "";
    return trimmed.charAt(0).toUpperCase();
  }, [loanedTo]);

  if (!loanedTo) return null;

  const TONE = {
    overdue: {
      kanji: "過",
      ring: "var(--hanko)",
      ink: "var(--hanko-bright)",
      label: t("loans.statusOverdue"),
      glow: "0 0 18px rgba(220,38,38,0.55), 0 0 4px rgba(220,38,38,0.4)",
    },
    due_soon: {
      kanji: "近",
      ring: "var(--gold)",
      ink: "var(--gold)",
      label: t("loans.statusDueSoon"),
      glow: "0 0 14px rgba(201,169,97,0.45)",
    },
    active: {
      kanji: "預",
      ring: "var(--hanko)",
      ink: "var(--hanko-bright)",
      label: t("loans.statusActive"),
      glow: "0 0 12px rgba(220,38,38,0.35)",
    },
    open: {
      kanji: "預",
      ring: "rgba(244,236,216,0.7)",
      ink: "var(--washi)",
      label: t("loans.statusOpen"),
      glow: "0 0 10px rgba(244,236,216,0.18)",
    },
  }[status];

  const ariaLabel = t("loans.stampAria", {
    status: TONE.label,
    borrower: loanedTo,
  });

  if (size === "sm") {
    // Compact corner stamp — anchored top-right, 18×18px circle
    // with kanji only. Sits above the existing collector / upcoming
    // badges on shelf tiles via right-side positioning negotiation
    // (see VolumeShelfTile call site, which moves collector to
    // left when a loan stamp is present).
    return (
      <span
        aria-label={ariaLabel}
        title={ariaLabel}
        className={`pointer-events-none absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full font-jp text-[10px] font-bold leading-none ${
          status === "overdue" ? "animate-pulse-glow" : ""
        }`}
        style={{
          background: "rgba(15,16,15,0.78)",
          color: TONE.ink,
          border: `1px solid ${TONE.ring}`,
          boxShadow: TONE.glow,
          transform: "rotate(-8deg)",
        }}
      >
        {TONE.kanji}
      </span>
    );
  }

  // Large center stamp. The disc sits at 58% of the cover width,
  // rotated to read as imprinted, not aligned to the grid. Built
  // from concentric `radial-gradient` + ring borders so the look
  // holds at any scale.
  return (
    <span
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center ${
        status === "overdue" ? "animate-pulse-glow" : ""
      }`}
    >
      <span
        className="grid place-items-center rounded-full"
        style={{
          width: "62%",
          aspectRatio: "1",
          // Two-stop radial: a translucent "ink-soaked paper" core
          // fading into the hanko-red ring on the outer 12% so the
          // cover artwork is still visible underneath.
          background: `radial-gradient(circle at 50% 45%, rgba(15,16,15,0.55) 0%, rgba(15,16,15,0.35) 56%, transparent 70%)`,
          border: `2px solid ${TONE.ring}`,
          boxShadow: `${TONE.glow}, inset 0 0 0 4px rgba(15,16,15,0.18), inset 0 0 0 5px ${TONE.ring}`,
          color: TONE.ink,
          transform: "rotate(-22deg)",
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
        }}
      >
        {/* Top ring inscription — kept thin and decorative. The
            curved positioning is faked with a wider character: the
            actual stamp aesthetic doesn't need a true SVG path
            here, the simple letter spacing reads as engraved. */}
        <span
          aria-hidden="true"
          className="font-mono text-[7px] uppercase leading-none"
          style={{
            position: "absolute",
            top: "10%",
            letterSpacing: "0.32em",
            opacity: 0.85,
          }}
        >
          ・預け・
        </span>
        <span
          className="font-jp font-bold leading-none"
          style={{
            fontSize: "min(2.6em, 64px)",
            lineHeight: "1",
            textShadow: `0 0 4px ${TONE.ring}, 0 1px 2px rgba(0,0,0,0.7)`,
          }}
        >
          {TONE.kanji}
        </span>
        {initial && (
          <span
            aria-hidden="true"
            className="font-mono text-[8px] uppercase leading-none tabular-nums"
            style={{
              position: "absolute",
              bottom: "12%",
              letterSpacing: "0.24em",
              opacity: 0.85,
            }}
          >
            ・{initial}・
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * 預 · CSS filter to apply on the cover image when a loan is
 * active. Communicates "out of circulation" without hiding the
 * artwork. Returns an empty string when no loan is set so the
 * call site can compose it into existing className/style maps
 * without conditionals.
 */
export function loanCoverFilter(loanedTo) {
  if (!loanedTo) return "";
  return "grayscale(0.45) brightness(0.78) contrast(1.05)";
}

/**
 * 預 · Lifecycle classifier — duplicated on purpose vs. the
 * frontend hook so the stamp component stays self-contained
 * (avoids a circular import with `useActiveLoans`). Same
 * thresholds: overdue / due-within-7-days / active / open.
 *
 * Exported so other surfaces (e.g. the no-cover Volume button)
 * can pick the matching tint without re-deriving the policy.
 */
export function classifyLoanStatus(loanDueAt, now = Date.now()) {
  if (!loanDueAt) return "open";
  const due = new Date(loanDueAt).getTime();
  if (Number.isNaN(due)) return "open";
  if (due < now) return "overdue";
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (due - now < sevenDays) return "due_soon";
  return "active";
}

const classify = classifyLoanStatus;

/**
 * 預 · Status kanji map. Matches the kanji used inside
 * `LoanStamp` so the no-cover button can stay consistent.
 */
export const LOAN_STATUS_KANJI = {
  overdue: "過",
  due_soon: "近",
  active: "預",
  open: "預",
};
