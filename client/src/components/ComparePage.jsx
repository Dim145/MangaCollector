import { useContext, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import CoverImage from "./ui/CoverImage.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import SettingsContext from "@/SettingsContext.js";
import {
  filterAdultGenreIfNeeded,
  hasToBlurImage,
} from "@/utils/library.js";
import { useCompare } from "@/hooks/useCompare.js";
import { useT } from "@/i18n/index.jsx";

/**
 * /compare/:slug · 対照 page.
 *
 * Three-panel layout: shared (middle, the "together shelf"), mine-only
 * (left), their-only (right). Header holds the two hanko seals
 * overlapping slightly to suggest the intersection; the three counts
 * reflect each bucket at a glance. Cards are read-only mini-covers
 * linking to the matching MangaPage for series I own, or falling back
 * to the other user's public profile card for series only they have.
 */
export default function ComparePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const { data, isLoading, isError, error } = useCompare(slug);
  const [tab, setTab] = useState("shared"); // mobile: one tab at a time
  // Respect the authed user's adult-content preference for the whole
  // compare page — backend already scrubs the OTHER user's adult
  // series per their public_show_adult, but we also have to honour
  // MY preference locally (my own series can be adult, and the shared
  // bucket is returned with my metadata which may include adult tags).
  const { adult_content_level } = useContext(SettingsContext);

  const status = error?.response?.status;
  const notFound = isError && status === 404;
  const selfCompare = isError && status === 400;

  // Apply the same filter as the dashboard uses — at level 1 ("hide")
  // adult-tagged series are dropped from every bucket; at level 0
  // ("blur") they stay visible but flagged so MiniCard blurs the
  // cover; at level 2 ("show") no change.
  const buckets = useMemo(
    () => ({
      shared: filterAdultGenreIfNeeded(adult_content_level, data?.shared ?? []),
      mine_only: filterAdultGenreIfNeeded(
        adult_content_level,
        data?.mine_only ?? [],
      ),
      their_only: filterAdultGenreIfNeeded(
        adult_content_level,
        data?.their_only ?? [],
      ),
    }),
    [data, adult_content_level],
  );

  return (
    <DefaultBackground>
      <div className="mx-auto max-w-7xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* ── Masthead ── */}
        <header className="mb-10 animate-fade-up">
          <div className="flex items-baseline gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim transition hover:text-washi"
            >
              ← {t("common.back")}
            </button>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-washi-dim">
              {t("compare.eyebrow")}
            </span>
          </div>

          {(notFound || selfCompare) && (
            <NotFoundState
              slug={slug}
              selfCompare={selfCompare}
            />
          )}

          {!notFound && !selfCompare && (
            <>
              <h1 className="mt-3 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-5xl">
                {isLoading ? (
                  <Skeleton.Stat width="18ch" />
                ) : (
                  <>
                    {t("compare.titleStart")}{" "}
                    <span className="text-hanko-gradient font-semibold not-italic">
                      {data?.me?.display_name ?? "…"}
                    </span>{" "}
                    <span className="font-mono text-2xl not-italic text-washi-dim md:text-3xl">
                      · 対 ·
                    </span>{" "}
                    <span className="text-ink-gradient font-semibold not-italic">
                      {data?.other?.display_name ?? slug}
                    </span>
                  </>
                )}
              </h1>

              {/* Twin hanko — overlapping slightly to suggest the
                  intersection happening visually between the two.
                  Counts here use the post-filter buckets so "shared /
                  overlap %" stay truthful after the user's adult
                  preference trimmed some entries. */}
              {!isLoading && data && (
                <div className="mt-6 flex items-center gap-5">
                  <HankoPair me={data.me} other={data.other} />
                  <BucketSummary
                    shared={buckets.shared.length}
                    mine={buckets.mine_only.length}
                    theirs={buckets.their_only.length}
                    otherName={data.other.display_name}
                    t={t}
                  />
                </div>
              )}
            </>
          )}
        </header>

        {!notFound && !selfCompare && isLoading && <ThreePanelSkeleton />}

        {!notFound && !selfCompare && !isLoading && data && (
          <>
            {/* Tabs — visible on mobile to pick a single bucket. On
                md+ we show all three side-by-side and hide the tabs. */}
            <div className="md:hidden mb-6 flex overflow-hidden rounded-full border border-border bg-ink-1/60 p-1 backdrop-blur">
              <TabButton
                active={tab === "shared"}
                onClick={() => setTab("shared")}
                count={buckets.shared.length}
                accent="moegi"
                label={t("compare.sharedShort")}
              />
              <TabButton
                active={tab === "mine_only"}
                onClick={() => setTab("mine_only")}
                count={buckets.mine_only.length}
                accent="hanko"
                label={t("compare.mineShort")}
              />
              <TabButton
                active={tab === "their_only"}
                onClick={() => setTab("their_only")}
                count={buckets.their_only.length}
                accent="gold"
                label={t("compare.theirsShort")}
              />
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-4 lg:gap-6">
              <Panel
                hidden={tab !== "mine_only"}
                order="md:order-1"
                accent="hanko"
                kanji="我"
                title={t("compare.mine", {
                  name: data.me.display_name,
                })}
                subtitle={t("compare.mineHint")}
                count={buckets.mine_only.length}
                entries={buckets.mine_only}
                adultLevel={adult_content_level}
                clickable
                navigate={navigate}
              />
              <Panel
                hidden={tab !== "shared"}
                order="md:order-2"
                accent="moegi"
                kanji="共"
                title={t("compare.shared")}
                subtitle={t("compare.sharedHint")}
                count={buckets.shared.length}
                entries={buckets.shared}
                adultLevel={adult_content_level}
                clickable
                navigate={navigate}
                highlight
              />
              <Panel
                hidden={tab !== "their_only"}
                order="md:order-3"
                accent="gold"
                kanji="彼"
                title={t("compare.theirs", {
                  name: data.other.display_name,
                })}
                subtitle={t("compare.theirsHint")}
                count={buckets.their_only.length}
                entries={buckets.their_only}
                adultLevel={adult_content_level}
                discover
                navigate={navigate}
              />
            </div>

            {/* Link to the other's public profile, footer-style */}
            {data.other.slug && (
              <div className="mt-10 flex items-center justify-center">
                <Link
                  to={`/u/${data.other.slug}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-ink-1/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-washi-muted transition hover:border-hanko/40 hover:text-washi"
                >
                  <span className="font-jp text-[12px]">蔵書</span>
                  {t("compare.seeProfile", {
                    name: data.other.display_name,
                  })}
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </DefaultBackground>
  );
}

/* ══════════════ Pieces ══════════════ */

function HankoPair({ me, other }) {
  return (
    <div className="relative inline-flex items-center">
      <div className="compare-hanko compare-hanko-mine">
        <span className="font-display text-xl font-bold">{me.hanko}</span>
      </div>
      <div className="compare-hanko compare-hanko-other">
        <span className="font-display text-xl font-bold">{other.hanko}</span>
      </div>
    </div>
  );
}

function BucketSummary({ shared, mine, theirs, otherName, t }) {
  const total = shared + mine + theirs;
  const overlapPct = total > 0 ? Math.round((shared / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1 font-sans text-xs italic text-washi-muted">
      <span>
        <span className="text-moegi font-semibold tabular-nums not-italic">
          {shared}
        </span>{" "}
        {t("compare.summaryShared")}
      </span>
      <span>
        {t("compare.summaryOverlap", { pct: overlapPct, name: otherName })}
      </span>
    </div>
  );
}

function TabButton({ active, onClick, count, accent, label }) {
  const activeCls =
    accent === "hanko"
      ? "bg-hanko text-washi"
      : accent === "gold"
        ? "bg-gold text-ink-0"
        : "bg-moegi text-ink-0";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
        active
          ? `${activeCls} shadow-md`
          : "text-washi-muted hover:text-washi"
      }`}
    >
      {label}
      <span className="ml-1.5 opacity-70 tabular-nums">{count}</span>
    </button>
  );
}

function Panel({
  hidden,
  order = "",
  accent,
  kanji,
  title,
  subtitle,
  count,
  entries,
  adultLevel,
  clickable,
  discover,
  highlight,
  navigate,
}) {
  const t = useT();
  const accentCls =
    accent === "hanko"
      ? "text-hanko-bright border-hanko/30"
      : accent === "gold"
        ? "text-gold border-gold/30"
        : "text-moegi border-moegi/30";
  return (
    <section
      className={`flex flex-col ${order} ${hidden ? "hidden md:flex" : ""}`}
      aria-label={title}
    >
      {/* Panel header */}
      <div
        className={`mb-4 rounded-2xl border bg-ink-1/50 p-4 backdrop-blur ${accentCls} ${
          highlight
            ? "shadow-[0_6px_24px_-8px_rgba(163,201,97,0.25)]"
            : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="font-jp text-2xl leading-none"
            style={{ transform: "rotate(-3deg)" }}
          >
            {kanji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-washi-dim">
              {subtitle}
            </p>
            <h3 className="font-display text-lg italic leading-tight text-washi truncate">
              {title}
            </h3>
          </div>
          <span className="font-display text-2xl font-semibold tabular-nums">
            {count}
          </span>
        </div>
      </div>

      {/* Grid */}
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-ink-1/20 p-6 text-center text-xs text-washi-muted">
          {t("compare.emptyBucket")}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry, i) => (
            <MiniCard
              key={entry.mal_id ?? `custom-${i}`}
              entry={entry}
              index={i}
              clickable={clickable}
              discover={discover}
              navigate={navigate}
              accent={accent}
              adultLevel={adultLevel}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MiniCard({
  entry,
  index,
  clickable,
  discover,
  navigate,
  accent,
  adultLevel,
}) {
  const t = useT();
  // level 1 already stripped this entry from the bucket; level 0 blurs
  // the cover; level 2 shows it fully. hasToBlurImage handles all 3.
  const blur = hasToBlurImage(entry, adultLevel);
  const onClick = () => {
    if (clickable && entry.mal_id && entry.mal_id > 0) {
      // Navigate to our local MangaPage for series we own.
      navigate("/mangapage", {
        state: {
          manga: {
            mal_id: entry.mal_id,
            name: entry.name,
            image_url_jpg: entry.image_url_jpg,
            volumes: entry.volumes,
            volumes_owned: 0,
            genres: entry.genres,
          },
        },
      });
    }
  };
  const hoverAccent =
    accent === "hanko"
      ? "group-hover:border-hanko/60"
      : accent === "gold"
        ? "group-hover:border-gold/60"
        : "group-hover:border-moegi/60";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col text-left animate-fade-up"
      style={{ animationDelay: `${Math.min(index * 30, 450)}ms` }}
      title={
        discover
          ? t("compare.discoverSeriesTitle", { name: entry.name })
          : entry.name
      }
    >
      <div
        className={`relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-border bg-ink-2 shadow-md transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-xl ${hoverAccent}`}
      >
        <CoverImage
          src={entry.image_url_jpg}
          alt=""
          blur={blur}
          imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink-0 via-ink-0/50 to-transparent" />
        {discover && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-sm bg-gold/85 text-ink-0 shadow"
            style={{ transform: "rotate(4deg)" }}
          >
            <span className="font-jp text-[9px] font-bold leading-none">
              見
            </span>
          </span>
        )}
        <p className="absolute inset-x-0 bottom-0 p-2 font-display text-[11px] font-semibold leading-tight text-washi drop-shadow-md line-clamp-2">
          {entry.name}
        </p>
      </div>
    </button>
  );
}

function ThreePanelSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <section key={i}>
          <div className="mb-4 rounded-2xl border border-border bg-ink-1/50 p-4">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, j) => (
              <Skeleton.Card key={j} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function NotFoundState({ slug, selfCompare }) {
  const t = useT();
  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center py-12 text-center animate-fade-up">
      <div className="hanko-seal mb-4 grid h-20 w-20 place-items-center rounded-md font-display text-2xl">
        無
      </div>
      <h1 className="font-display text-3xl font-light italic text-washi md:text-4xl">
        {selfCompare
          ? t("compare.selfTitle")
          : t("compare.notFoundTitle")}
      </h1>
      <p className="mt-3 max-w-md text-sm text-washi-muted">
        {selfCompare
          ? t("compare.selfBody")
          : t("compare.notFoundBody", { slug })}
      </p>
      <Link
        to="/dashboard"
        className="mt-6 rounded-full border border-border bg-ink-1/60 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted transition hover:border-hanko/50 hover:text-washi"
      >
        {t("compare.backHome")}
      </Link>
    </div>
  );
}
