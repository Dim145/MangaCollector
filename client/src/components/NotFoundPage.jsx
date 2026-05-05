import { Link, useNavigate } from "react-router-dom";
import DefaultBackground from "./DefaultBackground.jsx";
import MarginaliaPaper from "./ui/MarginaliaPaper.jsx";
import ChibiArchivist from "./ui/ChibiArchivist.jsx";
import { useT } from "@/i18n/index.jsx";

/**
 * 迷子 Maigo · 404 — route not found.
 *
 * Wired as the catch-all `<Route path="*" />` in App.jsx so any
 * URL that doesn't match a known route lands here instead of
 * rendering blank. Authentication-agnostic on purpose: this
 * page must always work, even for an anonymous visitor who
 * mistyped a URL into the address bar.
 *
 * Composition
 * -----------
 * The whole panel reuses `<MarginaliaPaper>` so the 404 reads
 * as a page from the same archivist's notebook the rest of the
 * app speaks through. Inside, the chibi mascot anchors the
 * upper half (the visual punch), then the kicker / italic
 * title / explanatory body / two CTAs stack underneath.
 *
 * Two CTAs:
 *   • Primary  → /dashboard (or /, see below) — gets the user
 *                back to a known surface in one click.
 *   • Secondary → `navigate(-1)` — the "I followed a bad link
 *                and want to retreat" affordance. Safer than
 *                hard-coding a destination because we don't
 *                know what flow the user was in.
 *
 * The dashboard CTA always points to `/dashboard`. If the
 * visitor isn't authenticated, ProtectedRoute will redirect
 * them to /log-in transparently — same chain every other
 * authenticated entry uses, no special-case needed here.
 */
export default function NotFoundPage() {
  const t = useT();
  const navigate = useNavigate();

  return (
    <DefaultBackground>
      <div className="mx-auto max-w-3xl px-4 pt-12 pb-nav md:pb-16 sm:px-6 md:pt-20">
        <MarginaliaPaper
          glyph="迷"
          glyphRotation={-4}
          chapterMark={t("notFound.chapterMark")}
          cornerStamp="探"
          inscription={t("notFound.inscription")}
          accent="hanko"
        >
          <div className="flex flex-col items-center gap-6">
            {/* 迷子 · The chibi sits above the textual block.
                Sized at 12rem on mobile, 14rem on tablet and
                up — small enough to read as a mascot rather
                than a billboard, large enough to carry the
                emotional cue that the body copy frames. */}
            <ChibiArchivist className="h-48 w-40 md:h-56 md:w-48" />

            <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-hanko">
              {t("notFound.kicker")}
            </p>

            <h1 className="font-display text-3xl font-light italic leading-tight text-washi md:text-4xl lg:text-5xl">
              {t("notFound.titlePre")}{" "}
              <span className="text-hanko-gradient font-semibold not-italic">
                {t("notFound.titleAccent")}
              </span>
              {t("notFound.titlePost")}
            </h1>

            <p className="max-w-md text-sm leading-relaxed text-washi-muted md:text-base">
              {t("notFound.body")}
            </p>

            {/* 戻 · Two CTAs side-by-side. The primary "back to
                dashboard" gets the hanko-stamp treatment; the
                secondary "go back" is a quieter ghost button so
                the eye lands on the primary first. */}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-full bg-hanko px-5 py-2.5 text-sm font-semibold text-washi shadow-lg transition-transform hover:scale-[1.03] active:scale-95"
              >
                <span aria-hidden="true" className="font-jp text-[14px] font-bold leading-none">
                  本
                </span>
                {t("notFound.backToDashboard")}
              </Link>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-ink-1/40 px-5 py-2.5 text-sm font-semibold text-washi-muted transition hover:border-hanko/50 hover:text-washi"
              >
                <span aria-hidden="true" className="font-jp text-[14px] font-bold leading-none">
                  戻
                </span>
                {t("notFound.goBack")}
              </button>
            </div>
          </div>
        </MarginaliaPaper>
      </div>
    </DefaultBackground>
  );
}
