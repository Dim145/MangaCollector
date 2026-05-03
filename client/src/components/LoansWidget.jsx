import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useT, useLang } from "@/i18n/index.jsx";
import { useActiveLoans, classifyLoan } from "@/hooks/useActiveLoans.js";
import CoverImage from "./ui/CoverImage.jsx";
import { formatCompactDate } from "@/utils/date.js";

/**
 * 預け Azuke · Outstanding-loans dashboard widget.
 *
 * Aesthetic direction: vintage library check-out card. Each loan is
 * a "due slip" — a hanko-stamped paper card with the borrower
 * inscribed in monospace, the volume number printed top-right like
 * an accession number, and a single date band indicating when the
 * book is due back. Overdue cards rotate slightly off-axis and gain
 * a hanko-red overdue stripe, like a stamp pressed across a stale
 * ledger entry.
 *
 * The widget collapses to nothing when no loans are active — we
 * deliberately don't render an "empty state" card on the dashboard
 * because the dashboard is dense enough; the user only sees this
 * surface when there's something to attend to.
 */
export default function LoansWidget() {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const { data: loans = [], isLoading } = useActiveLoans();

  // Sort + classify in one pass so the render path stays cheap.
  // The server already sorts overdue→due_soon→active→open, but we
  // re-classify locally so the visual chip is computed against the
  // user's current clock (handles long-running tabs gracefully).
  const enriched = useMemo(() => {
    const now = Date.now();
    return loans.map((l) => ({ ...l, status: classifyLoan(l, now) }));
  }, [loans]);

  // Hide entirely when nothing is lent — same logic as GapSuggestions
  // self-hide. Loading states show a single skeleton card so the
  // layout doesn't pop in if data arrives late.
  if (!isLoading && enriched.length === 0) return null;

  const overdueCount = enriched.filter((l) => l.status === "overdue").length;

  return (
    <section
      aria-label={t("loans.aria")}
      className="azuke-section animate-fade-up mt-10 md:mt-14"
      style={{ animationDelay: "100ms" }}
    >
      <header className="mb-5 flex flex-wrap items-baseline gap-3">
        <span
          aria-hidden="true"
          className="font-jp text-2xl font-bold leading-none text-hanko-bright"
        >
          預
        </span>
        <h2 className="font-display text-xl font-light italic text-washi md:text-2xl">
          {t("loans.title")}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
          {t("loans.kicker")}
        </span>
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent"
        />
        <span className="font-mono text-[11px] tabular-nums uppercase tracking-[0.2em] text-washi-dim">
          {enriched.length}{" "}
          {enriched.length === 1 ? t("loans.itemSingular") : t("loans.itemPlural")}
          {overdueCount > 0 && (
            <>
              {" · "}
              <span className="text-hanko-bright">
                {overdueCount} {t("loans.overdueShort")}
              </span>
            </>
          )}
        </span>
      </header>

      {/* Horizontal scroll-snap rail of due cards. On wide screens
          ~3 cards visible, on mobile one at a time.
          ── Vertical padding sized for hover overflow ──
          `overflow-x: auto` promotes `overflow-y: visible` to `auto`
          per CSS spec, so the rail also clips on the Y axis. Each
          card on hover lifts by translateY(-2px) and grows its
          gold drop-shadow by ~24px. We pad the rail with py-7
          (28px) on each side so the lift + shadow + the bottom
          hanko seal at -bottom-2 all stay inside the visible
          flow. The neg-margin / px tandem keeps the cards bleeding
          past the section edges horizontally as before. */}
      <ul
        role="list"
        className="azuke-rail -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-clip px-4 py-7 sm:gap-5"
        style={{
          // Allow the hover lift + drop-shadow to overflow the
          // y-axis up to 32px past the rail's clip box. Supported
          // in Chrome 90+ / Firefox 102+; gracefully ignored
          // elsewhere (the py-7 padding alone is enough on those
          // browsers since the clip happens at the padding edge,
          // not the content edge).
          overflowClipMargin: "32px",
        }}
      >
        {isLoading && enriched.length === 0
          ? Array.from({ length: 3 }).map((_, i) => (
              <li key={`sk-${i}`} className="snap-start shrink-0">
                <DueCardSkeleton />
              </li>
            ))
          : enriched.map((loan, i) => (
              <li
                key={loan.volume_id}
                className="snap-start shrink-0 animate-fade-up"
                style={{ animationDelay: `${150 + i * 60}ms` }}
              >
                <DueCard
                  loan={loan}
                  index={i}
                  lang={lang}
                  t={t}
                  onOpen={() =>
                    loan.mal_id != null
                      ? navigate("/mangapage", {
                          state: { manga: { mal_id: loan.mal_id } },
                        })
                      : null
                  }
                />
              </li>
            ))}
      </ul>
    </section>
  );
}

/**
 * Single due card. Layout shape mirrors a 19th-century library
 * check-out slip: top-row borrower line + accession-style volume
 * number, body shows the work title + cover, footer shows the
 * lend-date / due-date pair. The whole thing has a faux paper
 * texture (CSS noise mask) and a hanko stamp anchored bottom-right.
 */
function DueCard({ loan, index, lang, t, onOpen }) {
  const restTilt = index % 2 === 0 ? "-0.6deg" : "0.5deg";
  const lentLabel = formatCompactDate(loan.loan_started_at, lang) || "—";
  const dueLabel = loan.loan_due_at
    ? formatCompactDate(loan.loan_due_at, lang)
    : null;

  const statusToken = {
    overdue: {
      kanji: "過",
      classes:
        "border-hanko/60 bg-hanko/10 text-hanko-bright shadow-[0_0_0_1px_var(--hanko)/30]",
      label: t("loans.statusOverdue"),
    },
    due_soon: {
      kanji: "近",
      classes: "border-gold/50 bg-gold/8 text-gold",
      label: t("loans.statusDueSoon"),
    },
    active: {
      kanji: "貸",
      classes: "border-moegi/50 bg-moegi/8 text-moegi",
      label: t("loans.statusActive"),
    },
    open: {
      kanji: "預",
      classes: "border-border bg-ink-2/40 text-washi-dim",
      label: t("loans.statusOpen"),
    },
  }[loan.status] ?? {
    kanji: "預",
    classes: "border-border bg-ink-2/40 text-washi-dim",
    label: t("loans.statusOpen"),
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      className="azuke-card group relative flex w-[260px] flex-col overflow-hidden rounded-md border border-border/80 bg-washi-cream/4 text-left shadow-[0_14px_30px_-18px_rgba(0,0,0,0.7)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-gold/40 hover:shadow-[0_22px_38px_-18px_rgba(201,169,97,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 sm:w-[280px]"
      style={{ transform: `rotate(${restTilt})` }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "rotate(0deg) translateY(-3px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = `rotate(${restTilt})`;
      }}
      aria-label={t("loans.cardAria", {
        name: loan.series_name ?? "",
        vol: loan.vol_num,
        borrower: loan.loaned_to,
      })}
    >
      {/* Top notch — decorative clip-path corner triangle, hanko-red,
          mimics the punched corner of a circulation card. */}
      <span
        aria-hidden="true"
        className="azuke-corner absolute right-0 top-0 h-7 w-7 bg-hanko/15"
        style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }}
      />

      {/* Header row — borrower handle + volume number */}
      <div className="relative flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-washi-dim">
            {t("loans.borrowerLabel")}
          </p>
          <p
            className="mt-0.5 truncate font-display text-base font-semibold italic leading-tight text-washi"
            title={loan.loaned_to}
          >
            {loan.loaned_to}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-washi-dim">
            {t("loans.volNumLabel")}
          </p>
          <p className="mt-0.5 font-display text-lg font-light italic tabular-nums text-hanko-bright">
            #{loan.vol_num}
          </p>
        </div>
      </div>

      {/* Body — cover thumb (left) + title (right). The cover
          slot is an aspect-2/3 mini frame so the inner img inherits
          the slot dimensions cleanly. */}
      <div className="relative mt-3 flex gap-3 px-4">
        <div className="aspect-[2/3] h-20 shrink-0 overflow-hidden rounded-sm border border-border/60 bg-ink-2/40">
          {loan.series_image_url ? (
            <CoverImage
              src={loan.series_image_url}
              alt=""
              paletteSeed={loan.mal_id}
              imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center font-display text-3xl italic text-hanko/40">
              巻
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 self-end">
          <p className="line-clamp-2 font-display text-[13px] italic leading-snug text-washi-muted">
            {loan.series_name ?? t("loans.unknownSeries")}
          </p>
        </div>
      </div>

      {/* Date band — lend / due timestamps, presented as a passport-
          stamp dual-line. Mono caps, gentle gold rule between. */}
      <div className="relative mt-4 grid grid-cols-2 gap-3 border-t border-border/60 px-4 py-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-washi-dim">
            {t("loans.lentOn")}
          </p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-washi">
            {lentLabel}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-washi-dim">
            {t("loans.dueOn")}
          </p>
          <p
            className={`mt-0.5 font-mono text-[11px] tabular-nums ${
              loan.status === "overdue"
                ? "text-hanko-bright"
                : loan.status === "due_soon"
                  ? "text-gold"
                  : "text-washi"
            }`}
          >
            {dueLabel ?? "—"}
          </p>
        </div>
      </div>

      {/* Status chip — bottom edge ribbon */}
      <div
        className={`relative flex items-center justify-between gap-2 border-t px-4 py-2 ${statusToken.classes}`}
      >
        <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em]">
          <span aria-hidden="true" className="font-jp text-[11px] not-italic">
            {statusToken.kanji}
          </span>
          {statusToken.label}
        </span>
        {loan.status === "overdue" && dueLabel && (
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] tabular-nums">
            {daysOverdueLabel(loan.loan_due_at, t)}
          </span>
        )}
      </div>

      {/* Hanko stamp anchored bottom-right — the 預 imprint tipping
          off the corner. Rotated +6deg so it reads "pressed" rather
          than typeset. Half-bleeds outside the card for character. */}
      <span
        aria-hidden="true"
        className="azuke-hanko pointer-events-none absolute -bottom-2 -right-1 grid h-9 w-9 place-items-center rounded-full border border-hanko/55 bg-ink-1/95 font-jp text-sm font-bold text-hanko-bright shadow-md"
        style={{ transform: "rotate(6deg)" }}
      >
        預
      </span>

      {/* Paper noise overlay — very subtle grain */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        }}
      />
    </button>
  );
}

function DueCardSkeleton() {
  return (
    <div className="relative flex w-[260px] flex-col gap-3 rounded-md border border-border/60 bg-ink-1/40 p-4 sm:w-[280px]">
      <div className="flex justify-between">
        <span className="block h-3 w-20 rounded bg-ink-2/60" />
        <span className="block h-3 w-10 rounded bg-ink-2/60" />
      </div>
      <div className="flex gap-3">
        <span className="block aspect-[2/3] h-20 rounded-sm bg-ink-2/60" />
        <span className="block h-3 flex-1 self-end rounded bg-ink-2/40" />
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
        <span className="block h-3 w-16 rounded bg-ink-2/40" />
        <span className="block h-3 w-16 justify-self-end rounded bg-ink-2/40" />
      </div>
    </div>
  );
}

function daysOverdueLabel(iso, t) {
  if (!iso) return "";
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return "";
  const days = Math.max(1, Math.floor((Date.now() - due) / (1000 * 60 * 60 * 24)));
  return t("loans.daysOverdue", { n: days });
}
