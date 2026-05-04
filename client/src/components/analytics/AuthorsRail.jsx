/**
 * 人 · Top auteurs collected — vertical podium-style list.
 *
 * Top author goes oversized (image + big number), the others
 * stack as compact rows below. Rank is rendered as a hanko-red
 * circle on the left so the eye reads the order even when the
 * author names overflow.
 *
 * Each row is a Link to the author detail page when we have a
 * mal_id; falls back to a plain row for custom (negative-id)
 * authors that the page can't yet route to with confidence.
 */
import { Link } from "react-router-dom";
import CoverImage from "../ui/CoverImage.jsx";

export default function AuthorsRail({ authors, t, loading }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex h-20 animate-pulse items-center gap-4 rounded-2xl border border-border/60 bg-ink-1/40"
          />
        ))}
      </div>
    );
  }

  if (!authors?.length) {
    return (
      <p className="rounded-2xl border border-dashed border-border/70 bg-ink-1/30 px-6 py-10 text-center font-display italic text-washi-muted">
        {t("stats.authors.empty")}
      </p>
    );
  }

  const [first, ...rest] = authors;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr] lg:gap-6">
      {/* Hero — top author. Oversized, with poster collage. */}
      <FeaturedRow rank={1} author={first} t={t} />

      {/* Stacked rest. */}
      <ul className="flex flex-col gap-2">
        {rest.map((a, idx) => (
          <li key={a.name}>
            <CompactRow rank={idx + 2} author={a} t={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeaturedRow({ rank, author, t }) {
  const { posters, ownedVolumes, seriesCount, completionPct, name, author_mal_id } = author;
  const linkable = author_mal_id != null;
  const Wrapper = linkable ? Link : "div";
  const wrapperProps = linkable
    ? { to: `/author/${author_mal_id}`, className: "block" }
    : { className: "block" };
  return (
    <Wrapper
      {...wrapperProps}
      className={`group relative isolate flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-ink-1/55 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[color:var(--folio-accent,var(--hanko))]/55 hover:shadow-[0_22px_36px_-22px_color-mix(in_oklab,var(--folio-accent,var(--hanko))_55%,transparent)]`}
    >
      {/* Poster collage — up to 4 covers feathered as a horizontal strip. */}
      <div className="relative grid grid-cols-4 gap-px overflow-hidden bg-ink-2/60">
        {posters.length > 0 ? (
          posters.slice(0, 4).map((url, i) => (
            <div key={i} className="relative aspect-[3/4] overflow-hidden">
              <CoverImage
                src={url}
                alt=""
                className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.04]"
              />
            </div>
          ))
        ) : (
          <div className="col-span-4 flex aspect-[12/4] items-center justify-center font-display text-5xl italic text-hanko/30">
            人
          </div>
        )}
        {/* Gradient floor → lets text sit cleanly over the bottom edge. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-1/95 via-ink-1/80 to-transparent"
        />
        <RankBadge rank={rank} />
      </div>

      <div className="relative flex flex-1 flex-col gap-3 p-5 md:p-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-muted">
            {t("stats.authors.featuredEyebrow")}
          </p>
          <h3 className="mt-1 font-display text-2xl font-light italic leading-tight text-washi md:text-3xl">
            {name}
          </h3>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-left">
          <FigureCell
            label={t("stats.authors.volumes")}
            value={`${ownedVolumes} 巻`}
          />
          <FigureCell
            label={t("stats.authors.series")}
            value={`${seriesCount}`}
          />
          <FigureCell
            label={t("stats.authors.completion")}
            value={`${completionPct} %`}
          />
        </dl>

        <CompletionBar pct={completionPct} />
      </div>
    </Wrapper>
  );
}

function CompactRow({ rank, author, t }) {
  const { ownedVolumes, seriesCount, completionPct, name, author_mal_id } = author;
  const linkable = author_mal_id != null;
  const Wrapper = linkable ? Link : "div";
  const wrapperProps = linkable
    ? { to: `/author/${author_mal_id}`, className: "block" }
    : { className: "block" };
  return (
    <Wrapper
      {...wrapperProps}
      className="group flex items-center gap-3 rounded-xl border border-border/60 bg-ink-1/40 px-3 py-2.5 transition hover:border-[color:var(--folio-accent,var(--hanko))]/55 hover:bg-ink-1/60"
    >
      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border/70 bg-ink-2/60 font-mono text-[11px] font-semibold tabular-nums text-washi-muted group-hover:border-[color:var(--folio-accent,var(--hanko))]/55 group-hover:text-washi"
      >
        {String(rank).padStart(2, "0")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base italic text-washi md:text-lg">
          {name}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
          {ownedVolumes} {t("stats.authors.volumesShort")} · {seriesCount}{" "}
          {t("stats.authors.seriesShort")}
        </p>
      </div>
      <span
        className="shrink-0 font-mono text-[11px] tabular-nums"
        style={{ color: "var(--folio-accent, var(--hanko))" }}
      >
        {completionPct}%
      </span>
    </Wrapper>
  );
}

function RankBadge({ rank }) {
  return (
    <span
      aria-hidden="true"
      className="absolute left-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-hanko/70 bg-hanko/90 font-jp text-base font-bold text-washi shadow-[0_4px_14px_-4px_rgba(0,0,0,0.5)]"
      style={{ transform: "rotate(-4deg)" }}
    >
      {rank === 1 ? "壱" : rank === 2 ? "弐" : "参"}
    </span>
  );
}

function FigureCell({ label, value }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
        {label}
      </p>
      <p className="mt-1 font-display text-lg font-light italic text-washi tabular-nums md:text-xl">
        {value}
      </p>
    </div>
  );
}

function CompletionBar({ pct }) {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-ink-2/60">
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${clamped}%`,
          background:
            "linear-gradient(90deg, var(--folio-accent, var(--hanko)) 0%, color-mix(in oklab, var(--folio-accent, var(--hanko)) 70%, white) 100%)",
        }}
      />
    </div>
  );
}
