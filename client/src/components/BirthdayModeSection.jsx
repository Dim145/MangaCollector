import { useState } from "react";
import { useWishlistPublic } from "@/hooks/useWishlistPublic.js";
import { useOwnPublicSlug } from "@/hooks/usePublicProfile.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 祝 · Settings section — temporary public exposure of wishlist entries.
 *
 * The public profile gallery hides series the owner is tracking but
 * doesn't yet own (`volumes_owned === 0`). This toggle lifts that
 * filter for a finite window — useful before an anniversary, wedding
 * or housewarming so visitors can pick a gift without guesswork.
 *
 * Side-effects: zero. The wishlist entries reappear on `/u/{slug}`,
 * the rest of the profile is untouched, the timer expires on its own
 * (server-clamped to 365 days max).
 *
 * Disabled when the public profile itself is off — without a slug
 * there's nowhere for the wishlist to live publicly anyway.
 */
export default function BirthdayModeSection() {
  const t = useT();
  const { slug } = useOwnPublicSlug();
  const { until, isActive, pending, setDays, deactivate } = useWishlistPublic();
  const [error, setError] = useState(null);

  const publicProfileOff = !slug;

  const arm = async (days) => {
    setError(null);
    try {
      await setDays(days);
    } catch (err) {
      setError(err?.response?.data?.error ?? err?.message ?? "Failed");
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await deactivate();
    } catch (err) {
      setError(err?.response?.data?.error ?? err?.message ?? "Failed");
    }
  };

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border p-6 backdrop-blur animate-fade-up ${
        isActive
          ? "border-sakura/45 bg-gradient-to-br from-sakura/10 via-ink-1/60 to-ink-1/40"
          : "border-border bg-ink-1/50"
      }`}
      style={{ animationDelay: "270ms" }}
    >
      {/* Ornamental kanji watermark — pinned to a corner so the active
          state still feels celebratory without becoming carnival. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute -bottom-6 -right-4 select-none font-display italic font-light leading-none ${
          isActive ? "text-sakura/15" : "text-sakura/5"
        }`}
        style={{ fontSize: "10rem" }}
      >
        祝
      </span>

      <div className="relative">
        <div className="mb-4 flex items-baseline gap-2">
          <span
            aria-hidden="true"
            className="font-jp text-lg font-bold leading-none text-sakura"
          >
            祝
          </span>
          <h2 className="font-display text-lg font-semibold text-washi">
            {t("settings.birthdayHeading")}
          </h2>
        </div>
        <p className="text-xs text-washi-muted md:text-sm">
          {t("settings.birthdayBody")}
        </p>

        {publicProfileOff && (
          <p className="mt-3 rounded-lg border border-gold/20 bg-gold/5 px-3 py-2 text-[11px] text-washi-muted">
            {t("settings.birthdayRequiresPublic")}
          </p>
        )}

        {isActive ? (
          /* Active state — countdown chip + Stop CTA. */
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sakura/35 bg-sakura/10 px-4 py-3">
              <span
                aria-hidden="true"
                className="font-jp text-base font-bold leading-none text-sakura"
              >
                祝
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
                  {t("settings.birthdayActive")}
                </p>
                <p className="mt-0.5 font-display text-base italic text-washi">
                  {t("settings.birthdayUntil", {
                    date: formatDate(until),
                    days: daysRemaining(until),
                  })}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={pending}
              onClick={stop}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:border-hanko/50 hover:text-washi disabled:opacity-60"
            >
              {t("settings.birthdayStop")}
            </button>
          </div>
        ) : (
          /* Idle state — three preset durations. The wide range lets
             the user match the lifetime to the actual occasion: a
             surprise gift list (7 days), a birthday window (30 days)
             or a long-running collection-completion drive (90 days). */
          <div className="mt-5 flex flex-wrap gap-2">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                disabled={pending || publicProfileOff}
                onClick={() => arm(days)}
                className="group inline-flex items-center gap-2 rounded-full border border-sakura/40 bg-sakura/10 px-4 py-2 text-sm font-semibold text-washi transition hover:border-sakura hover:bg-sakura/20 disabled:cursor-not-allowed disabled:border-border disabled:bg-ink-2/40 disabled:text-washi-dim"
              >
                <span
                  aria-hidden="true"
                  className="font-jp text-base font-bold leading-none text-sakura transition-transform group-hover:scale-110"
                >
                  祝
                </span>
                {t("settings.birthdayArm", { days })}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-hanko/30 bg-hanko/5 px-3 py-2 text-xs text-hanko-bright">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Format an ISO date as a locale-aware "Friday, 24 May 2026" string.
 * Falls back to ISO-day on environments without `Intl` (rare).
 */
function formatDate(d) {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Whole days remaining between now and `d`, floored at 0. */
function daysRemaining(d) {
  if (!d) return 0;
  const ms = d.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}
