import { useContext, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import CoverImage from "./ui/CoverImage.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import Modal from "./ui/Modal.jsx";
import SettingsContext from "@/SettingsContext.js";
import {
  filterAdultGenreIfNeeded,
  hasToBlurImage,
} from "@/utils/library.js";
import { useCompare, useCopyFromCompare } from "@/hooks/useCompare.js";
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

  // "Add to my library" confirmation modal state. Tracks which entry
  // from their-only the user clicked so the modal can render its
  // cover + name + volume count and pass the mal_id to the mutation.
  const [addCandidate, setAddCandidate] = useState(null);
  const { copy, isCopying, error: copyError, result: copyResult, reset } =
    useCopyFromCompare(slug);

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
        <header className="relative mb-10 animate-fade-up">
          {/* 対 (tai, "versus / facing each other") watermark — the page
              already pronounces "対" inline in the title ("Vous · 対 ·
              Eux"), so the watermark amplifies the same kanji at scale.
              The watermark lives in its own absolute clip-layer so any
              shadow / overhang on adjacent content (HankoPair glows,
              skeleton chips, etc.) is left untouched — putting
              `overflow-hidden` on the header itself would clip those. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
          >
            <span className="absolute -right-10 -top-16 select-none font-jp text-[28rem] font-bold leading-none text-hanko/[0.06]">
              対
            </span>
          </div>

          <div className="relative">
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
          </div>
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
                onDiscoverClick={(entry) => {
                  reset();
                  setAddCandidate(entry);
                }}
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

        {/* Confirmation modal — shown when the user clicks a card in
            the "their only" panel. Lives here rather than inside the
            card so the async mutation state survives the user closing
            and reopening modals. */}
        <AddToMyLibraryModal
          candidate={addCandidate}
          onClose={() => {
            setAddCandidate(null);
            reset();
          }}
          onConfirm={async () => {
            if (!addCandidate?.mal_id) return;
            try {
              await copy(addCandidate.mal_id);
              // Hold the modal open for one more tick so the success
              // state gets to render; the user dismisses it.
            } catch {
              /* handled via copyError in the modal below */
            }
          }}
          onSeeSeries={() => {
            const res = copyResult?.entry;
            if (!res) return;
            const target = addCandidate;
            setAddCandidate(null);
            reset();
            navigate("/mangapage", {
              state: {
                manga: {
                  mal_id: res.mal_id ?? target?.mal_id,
                  name: res.name ?? target?.name,
                  image_url_jpg: res.image_url_jpg ?? target?.image_url_jpg,
                  volumes: res.volumes ?? target?.volumes,
                  volumes_owned: 0,
                  genres: res.genres ?? target?.genres ?? [],
                },
              },
              viewTransition: true,
            });
          }}
          adultLevel={adult_content_level}
          isCopying={isCopying}
          copyError={copyError}
          copyResult={copyResult}
          otherName={data?.other?.display_name}
        />
      </div>
    </DefaultBackground>
  );
}

/* ══════════════ Add-to-my-library confirmation modal ══════════════ */

function AddToMyLibraryModal({
  candidate,
  onClose,
  onConfirm,
  onSeeSeries,
  adultLevel,
  isCopying,
  copyError,
  copyResult,
  otherName,
}) {
  const t = useT();
  const open = Boolean(candidate);
  const done = Boolean(copyResult);
  const blur = candidate ? hasToBlurImage(candidate, adultLevel) : false;

  return (
    <Modal
      popupOpen={open}
      handleClose={onClose}
      additionalClasses="w-[min(95vw,520px)] rounded-2xl border border-border bg-ink-1 p-0"
    >
      {candidate && (
        <div className="flex flex-col">
          {/* Header — cover + name */}
          <div className="flex gap-4 border-b border-border/60 bg-ink-2/30 p-5">
            <div className="aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-md border border-border shadow-md">
              <CoverImage
                src={candidate.image_url_jpg}
                alt=""
                blur={blur}
                paletteSeed={candidate.mal_id}
                imgClassName="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
                {done
                  ? t("compare.addDoneEyebrow")
                  : t("compare.addEyebrow", { name: otherName })}
              </p>
              <h3 className="mt-1 font-display text-2xl font-light italic leading-tight text-washi">
                {candidate.name}
              </h3>
              <p className="mt-2 font-mono text-[10px] tabular-nums text-washi-muted">
                {candidate.volumes > 0
                  ? t("compare.addVolumesHint", { n: candidate.volumes })
                  : t("compare.addUnknownVolumesHint")}
              </p>
              {candidate.genres?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {candidate.genres.slice(0, 4).map((g) => (
                    <span
                      key={g}
                      className="rounded-full border border-border bg-ink-1/60 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-washi-muted"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            {done ? (
              <div className="flex items-start gap-3">
                <span
                  className="hanko-seal grid h-10 w-10 shrink-0 place-items-center rounded-md font-display text-base"
                  style={{ transform: "rotate(-4deg)" }}
                >
                  印
                </span>
                <p className="text-sm text-washi">
                  {t("compare.addDoneBody", { n: candidate.volumes })}
                </p>
              </div>
            ) : (
              <p className="text-sm text-washi-muted">
                {t("compare.addBody", { n: candidate.volumes })}
              </p>
            )}

            {copyError && (
              <p className="mt-3 rounded-md border border-hanko/30 bg-hanko/10 px-3 py-2 text-xs text-hanko-bright">
                {copyError?.response?.data?.error ??
                  t("compare.addError")}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-ink-2/20 px-5 py-3">
            {done ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-border bg-transparent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted transition hover:text-washi"
                >
                  {t("common.close")}
                </button>
                <button
                  type="button"
                  onClick={onSeeSeries}
                  className="rounded-full bg-hanko px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-washi shadow-lg transition hover:bg-hanko-bright"
                >
                  {t("compare.addSeeSeries")}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isCopying}
                  className="rounded-full border border-border bg-transparent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-muted transition hover:text-washi disabled:opacity-40"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={isCopying}
                  className="inline-flex items-center gap-2 rounded-full bg-hanko px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-washi shadow-lg transition hover:bg-hanko-bright disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isCopying ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
                  ) : null}
                  {t("compare.addConfirm")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
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
  onDiscoverClick,
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
              onDiscoverClick={onDiscoverClick}
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
  onDiscoverClick,
  navigate,
  accent,
  adultLevel,
}) {
  const t = useT();
  // level 1 already stripped this entry from the bucket; level 0 blurs
  // the cover; level 2 shows it fully. hasToBlurImage handles all 3.
  const blur = hasToBlurImage(entry, adultLevel);
  const onClick = () => {
    if (discover) {
      // "Their only" click — open the add-to-my-library confirmation.
      // We route the click up so the page owns the modal state (the
      // modal is portal'd and needs the mutation state the page holds).
      onDiscoverClick?.(entry);
      return;
    }
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
          paletteSeed={entry.mal_id}
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
