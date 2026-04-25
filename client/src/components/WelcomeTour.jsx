import { useNavigate } from "react-router-dom";
import Modal from "./ui/Modal.jsx";
import { markTourSeen, setTourStep, TOUR_STEPS } from "@/lib/tour.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 始 · Welcome tour.
 *
 * An editorial three-step welcome shown on the very first visit to an
 * empty library. Each step is a card carrying a single Japanese
 * character + a romaji gloss + a short body + a CTA that navigates the
 * user straight into the action. The user can dismiss with Escape, the
 * close button, or by clicking any of the three CTAs (which mark the
 * tour as seen and route them to the relevant flow).
 *
 * Re-triggerable from the Settings page (`resetTourSeen()` from
 * `@/lib/tour.js` wipes the persisted flag).
 */

export default function WelcomeTour({ open, onClose }) {
  const navigate = useNavigate();
  const t = useT();

  // Closing the tour from anywhere persists the "seen" flag so we don't
  // surface it again on the next dashboard visit. The Settings page can
  // call `resetTourSeen()` to opt the user back in deliberately.
  const close = () => {
    markTourSeen();
    onClose?.();
  };

  // Hand off to the destination page via a session-scoped step flag
  // (consumed at mount, cleared in the same call). The receiving page
  // does the actual work — autofocus the search, open the scanner,
  // spotlight the avatar — so the tour stops being a "modal that hopes
  // you find the right button" and becomes a real choreographed handoff.
  const goto = (path, step) => {
    markTourSeen();
    setTourStep(step);
    onClose?.();
    navigate(path);
  };

  // Three steps — kanji + romaji ladder so the cards keep a consistent
  // typographic skeleton even in languages where the body wraps
  // unevenly. Each kanji belongs to the project's existing character
  // family (始, 探, 印 are siblings of 願 / 限 / 完 / 積).
  const steps = [
    {
      id: TOUR_STEPS.LIBRARY,
      kanji: "始",
      romaji: "hajime",
      title: t("tour.s1Title"),
      body: t("tour.s1Body"),
      cta: t("tour.s1Cta"),
      onClick: () => goto("/addmanga", TOUR_STEPS.LIBRARY),
    },
    {
      id: TOUR_STEPS.SCAN,
      kanji: "探",
      romaji: "sagasu",
      title: t("tour.s2Title"),
      body: t("tour.s2Body"),
      cta: t("tour.s2Cta"),
      onClick: () => goto("/addmanga", TOUR_STEPS.SCAN),
    },
    {
      id: TOUR_STEPS.AVATAR,
      kanji: "印",
      romaji: "in",
      title: t("tour.s3Title"),
      body: t("tour.s3Body"),
      cta: t("tour.s3Cta"),
      onClick: () => goto("/profile", TOUR_STEPS.AVATAR),
    },
  ];

  return (
    <Modal
      popupOpen={open}
      handleClose={close}
      additionalClasses="w-full max-w-3xl"
    >
      <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-ink-1 via-ink-1/95 to-ink-0 p-6 backdrop-blur md:p-10">
        {/* Ornamental kanji watermark — pinned to the bottom-right corner
            so the typography signature carries through even before the user
            reads any of the body copy. Pointer-events-none so clicks on the
            CTAs aren't intercepted. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-10 -right-6 select-none font-display text-[16rem] italic font-light leading-none text-hanko/5"
        >
          始
        </span>

        <div className="relative">
          {/* Masthead — supertitle pattern matches the rest of the app
              (`MASTHEAD · 漢字`), with the welcome heading underneath in
              the same italic display voice. */}
          <header className="text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
              {t("tour.kicker")} · 始
            </p>
            <h2
              data-autofocus
              tabIndex={-1}
              className="mt-3 font-display text-3xl font-light italic leading-tight text-washi md:text-5xl"
            >
              {t("tour.headingPre")}{" "}
              <span className="text-hanko-gradient font-semibold not-italic">
                {t("tour.headingAccent")}
              </span>
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-washi-muted md:text-base">
              {t("tour.intro")}
            </p>
          </header>

          {/* Three step cards. Stack on mobile, three columns from md.
              Each card is a button so the whole surface is the click
              target — easier on touch than a small CTA at the bottom. */}
          <div className="mt-8 grid gap-3 md:mt-10 md:grid-cols-3 md:gap-4">
            {steps.map((step, i) => (
              <button
                key={step.id}
                type="button"
                onClick={step.onClick}
                className="group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border border-border bg-ink-2/40 p-5 text-left transition hover:-translate-y-0.5 hover:border-hanko/50 hover:bg-ink-2/70 focus-visible:border-hanko focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hanko/40 animate-fade-up"
                style={{ animationDelay: `${120 + i * 80}ms` }}
              >
                {/* Step index — discreet pagination on top-right so the
                    user knows it's a 3-card sequence even if they only see
                    two on a narrow screen. */}
                <span className="absolute right-4 top-4 font-mono text-[10px] tabular-nums text-washi-dim">
                  {String(i + 1).padStart(2, "0")} / 03
                </span>

                <div className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className="font-jp text-4xl font-bold leading-none text-hanko-gradient md:text-5xl"
                  >
                    {step.kanji}
                  </span>
                  <span className="font-display text-xs italic text-washi-dim">
                    {step.romaji}
                  </span>
                </div>

                <h3 className="font-display text-base font-semibold text-washi md:text-lg">
                  {step.title}
                </h3>
                <p className="text-xs leading-relaxed text-washi-muted md:text-sm">
                  {step.body}
                </p>

                <span className="mt-auto inline-flex items-center gap-1.5 pt-2 font-mono text-[10px] uppercase tracking-wider text-hanko-bright transition-transform group-hover:translate-x-1">
                  {step.cta}
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
            ))}
          </div>

          {/* Footer — dismiss link + a subtle reminder that the tour can
              be replayed later from Settings. Treated as quiet text rather
              than a competing button so it doesn't pull attention away
              from the three primary actions. */}
          <footer className="mt-8 flex flex-col items-center gap-2 text-center md:mt-10">
            <button
              type="button"
              onClick={close}
              className="font-mono text-[10px] uppercase tracking-[0.25em] text-washi-dim transition hover:text-washi"
            >
              {t("tour.skip")}
            </button>
            <p className="font-display text-[11px] italic text-washi-dim">
              {t("tour.replayHint")}
            </p>
          </footer>
        </div>
      </div>
    </Modal>
  );
}
