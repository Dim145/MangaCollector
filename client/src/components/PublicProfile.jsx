import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { usePublicProfile, useOwnPublicSlug } from "@/hooks/usePublicProfile.js";
import { getCachedUser } from "@/utils/auth.js";
import Skeleton from "./ui/Skeleton.jsx";
import CoverImage from "./ui/CoverImage.jsx";
import { useT } from "@/i18n/index.jsx";

/** localStorage key for the visitor's "reveal adult content" choice,
 *  scoped per-profile so revealing on @alice doesn't leak into @bob. */
const ADULT_REVEAL_KEY = (slug) => `mc:public-adult:${slug}`;

/**
 * /u/:slug — read-only public profile gallery.
 *
 * Esthetic: "museum". Different from the dashboard on purpose — more
 * editorial, more contemplative, no edit actions anywhere. The palette
 * leans into washi paper + hanko red + a gold vignette at corner, with
 * generous negative space around the grid.
 */
export default function PublicProfile() {
  const { slug } = useParams();
  const t = useT();
  const { data, isLoading, isError, error } = usePublicProfile(slug);

  const notFound = isError && error?.response?.status === 404;

  // Visitor's adult-content reveal state — persisted per-slug so a user
  // who confirmed once on /u/alice stays confirmed if they come back,
  // but has to re-confirm on /u/bob. Stored in localStorage.
  const [adultRevealed, setAdultRevealed] = useState(false);
  useEffect(() => {
    if (!slug) return;
    try {
      setAdultRevealed(
        localStorage.getItem(ADULT_REVEAL_KEY(slug)) === "1",
      );
    } catch {
      setAdultRevealed(false);
    }
  }, [slug]);
  const toggleAdultReveal = () => {
    const next = !adultRevealed;
    setAdultRevealed(next);
    try {
      if (next) localStorage.setItem(ADULT_REVEAL_KEY(slug), "1");
      else localStorage.removeItem(ADULT_REVEAL_KEY(slug));
    } catch {
      /* ignore quota / private mode */
    }
  };

  return (
    <div className="public-profile min-h-[calc(100svh-4rem)] relative">
      {/* Ambient background — soft washi gradient distinct from the
          private dashboard. Goldleaf halo at bottom-right, hanko glow
          at top-left, grain overlay on top. */}
      <div aria-hidden="true" className="public-profile-canvas" />

      <div className="relative mx-auto max-w-6xl px-5 pt-10 pb-24 sm:px-8 md:pt-16">
        {/* ─── Masthead ─── */}
        {notFound ? (
          <NotFoundState slug={slug} />
        ) : (
          <>
            <Masthead data={data} isLoading={isLoading} slug={slug} />

            {/* ─── Adult-content warning banner ───
                Visible only when the owner has opted-in AND the library
                genuinely contains adult-tagged entries. Gold palette —
                qualitative warning, not an error. Clicking the action
                toggles the reveal state (persisted per-slug). */}
            {data?.has_adult_content && (
              <AdultWarningBanner
                revealed={adultRevealed}
                onToggle={toggleAdultReveal}
              />
            )}

            {/* ─── Divider ornament — paper seal + brush stroke ─── */}
            <div
              aria-hidden="true"
              className="my-10 flex items-center justify-center gap-4"
            >
              <span className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-border" />
              <span className="font-jp text-base text-hanko/70 tracking-[0.4em]">
                蔵書
              </span>
              <span className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-border" />
            </div>

            {/* ─── 祝 Birthday-mode banner ───
                Surfaced only when the owner has armed the wishlist
                exposure window. Sits above the gallery so a visitor
                browsing for a gift idea immediately understands which
                entries are wished-for vs. owned. */}
            {data?.wishlist_open_until && (
              <BirthdayBanner until={data.wishlist_open_until} />
            )}

            {/* ─── Gallery grid ───
                Wishlist filter — series the owner is *tracking* but doesn't
                actually own a single volume of (`volumes_owned === 0`) are
                normally excluded from the public museum (a registry of
                intent would leak future-purchase signals). When the owner
                opens the 祝 birthday window, that filter is lifted: the
                wishlist appears alongside the rest of the shelf, exactly
                so visitors can pick a gift. The window is server-clamped
                and self-expires; once it lapses, this branch reverts to
                the normal hide-wishlist behaviour automatically. */}
            {(() => {
              const wishlistOpen = Boolean(data?.wishlist_open_until);
              const visibleLibrary = (data?.library ?? []).filter((e) => {
                if (wishlistOpen) return true;
                return (e.volumes_owned ?? 0) > 0;
              });
              if (isLoading) return <GallerySkeleton />;
              if (visibleLibrary.length === 0) return <EmptyGallery />;
              return (
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {visibleLibrary.map((entry, i) => (
                    <PublicCard
                      key={entry.mal_id ?? `custom-${i}`}
                      entry={entry}
                      index={i}
                      blurAdult={!adultRevealed}
                    />
                  ))}
                </div>
              );
            })()}

            {/* ─── Footer ─── */}
            <footer className="mt-16 flex flex-col items-center gap-2 text-center">
              <span
                aria-hidden="true"
                className="font-jp text-sm text-washi-dim tracking-[0.4em]"
              >
                ·
              </span>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
                {t("publicProfile.footerPoweredBy")}
              </p>
              <Link
                to="/"
                className="font-display text-sm italic text-washi-muted transition hover:text-hanko"
              >
                MangaCollector
              </Link>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/** Hero masthead — name in display italic, hanko seal, three stat chips. */
function Masthead({ data, isLoading, slug }) {
  const t = useT();
  return (
    <header className="relative animate-fade-up">
      <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-washi-dim">
        {t("publicProfile.archiveOf")}{" "}
        <span className="text-hanko-bright">@{slug}</span>
      </p>

      <div className="mt-3 flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-5xl font-light italic leading-none tracking-tight text-washi md:text-7xl">
            {isLoading ? (
              <Skeleton.Stat width="14ch" />
            ) : (
              <span className="text-ink-gradient">{data?.display_name}</span>
            )}
          </h1>
          <p className="mt-4 max-w-lg font-sans text-sm italic text-washi-muted">
            {!isLoading && data?.since && (
              <>
                {t("publicProfile.archivistSince", {
                  date: formatSince(data.since),
                })}
              </>
            )}
          </p>

          {/* Stat chips — series · owned · read · fully-read */}
          {!isLoading && data?.stats && (
            <div
              className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
              aria-label={t("publicProfile.statsLabel")}
            >
              <PublicStat
                kanji="作"
                label={t("publicProfile.statSeries")}
                value={data.stats.series_count}
              />
              <PublicStat
                kanji="印"
                label={t("publicProfile.statOwned")}
                value={data.stats.volumes_owned}
                accent="hanko"
              />
              <PublicStat
                kanji="読"
                label={t("publicProfile.statRead")}
                value={data.stats.volumes_read}
                accent="moegi"
              />
              <PublicStat
                kanji="完"
                label={t("publicProfile.statFullyRead")}
                value={data.stats.fully_read_series}
                accent="gold"
              />
            </div>
          )}
        </div>

        {/* Hanko seal — large red square with the derived initials,
            tilted, with a gold satellite ornament suggesting the corner
            of a museum label. */}
        <div
          aria-hidden="true"
          className="relative shrink-0"
          style={{ marginTop: "0.5rem" }}
        >
          <div className="public-hanko">
            <span className="font-display text-2xl font-bold">
              {isLoading ? "・・" : data?.hanko ?? "・・"}
            </span>
          </div>
          <span className="public-hanko-dot" />
        </div>
      </div>

      {/* Compare CTA — only shown when a logged-in visitor is looking
          at someone ELSE's profile. Anonymous visitors and the
          profile's owner see nothing here. */}
      {!isLoading && data && <CompareCTA slug={slug} />}
    </header>
  );
}

/**
 * Renders a "Compare your libraries" link when the current viewer is
 * logged-in AND the profile shown isn't their own. Uses the cheap
 * `getCachedUser()` check first (no network) and only probes
 * `/api/user/public-slug` lazily via `useOwnPublicSlug` once we know
 * there's a session to test.
 */
function CompareCTA({ slug }) {
  const t = useT();
  const cached = typeof window !== "undefined" ? getCachedUser() : null;
  const { slug: ownSlug, isLoading } = useOwnPublicSlug();
  // Don't render if we can't prove we're logged in yet, or if this
  // is our own profile.
  if (!cached) return null;
  if (isLoading) return null;
  if (ownSlug && ownSlug === slug) return null;
  return (
    <div className="mt-6">
      <Link
        to={`/compare/${encodeURIComponent(slug)}`}
        className="inline-flex items-center gap-2 rounded-full border border-hanko/40 bg-hanko/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.25em] text-hanko-bright transition hover:bg-hanko/20 hover:border-hanko/60"
      >
        <span aria-hidden="true" className="font-jp text-sm leading-none">
          対
        </span>
        {t("publicProfile.compareCta")}
      </Link>
    </div>
  );
}

/** A single stat chip on the masthead. */
function PublicStat({ kanji, label, value, accent }) {
  const colour =
    accent === "hanko"
      ? "text-hanko-bright"
      : accent === "moegi"
        ? "text-moegi"
        : accent === "gold"
          ? "text-gold"
          : "text-washi";
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-ink-1/50 px-4 py-3 backdrop-blur transition hover:border-hanko/30">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className={`font-jp text-lg leading-none ${colour}`}
        >
          {kanji}
        </span>
        <span
          className={`font-display text-2xl font-semibold tabular-nums ${colour}`}
        >
          {value}
        </span>
      </div>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
      </p>
    </div>
  );
}

/** Read-only gallery card — cover + title + tiny state ribbon. */
function PublicCard({ entry, index, blurAdult }) {
  const t = useT();
  const owned = entry.volumes_owned ?? 0;
  const total = entry.volumes ?? 0;
  const complete = total > 0 && owned >= total;
  // 願 Wishlist surfaces only when the owner has armed the birthday
  // window — the parent gallery already filters out wishlist rows in
  // the closed state, so reaching this branch implies "open window".
  // We still gate the visual on `total > 0` so a custom-imported
  // series with an unknown total isn't misclassified as wishlist.
  const isWishlist = total > 0 && owned === 0;
  const isMuted = entry.is_adult && blurAdult;

  return (
    <div
      className="public-card group relative flex flex-col animate-fade-up"
      style={{ animationDelay: `${Math.min(index * 40, 600)}ms` }}
    >
      <div
        className={`relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-ink-2 shadow-lg transition-all duration-500 group-hover:-translate-y-1 group-hover:shadow-2xl ${
          // Idle border picks up the wishlist state — same dashed
          // sakura ring used on the dashboard's Manga card so a
          // visitor who's seen one immediately recognises the other.
          isWishlist
            ? "border border-dashed border-sakura/40"
            : "border border-border"
        } ${
          entry.all_collector
            ? "group-hover:border-gold/60"
            : complete
              ? "group-hover:border-moegi/60"
              : isWishlist
                ? "group-hover:border-sakura/70"
                : "group-hover:border-hanko/50"
        }`}
      >
        {/* CoverImage handles both the "no URL" and "URL dead" cases
            with a single placeholder. `isMuted` stacks the adult-blur
            filter on top when the visitor hasn't confirmed yet. */}
        <CoverImage
          src={entry.image_url_jpg}
          alt=""
          imgClassName={`h-full w-full object-cover transition-all duration-700 group-hover:scale-105 ${
            isMuted ? "blur-xl scale-110 brightness-50" : ""
          }`}
        />
        {isMuted && (
          // Darken the placeholder too when the adult filter is on —
          // otherwise a public-card with no cover would expose the
          // adult seal/title overlay against a clean kanji backdrop.
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-ink-0/60"
          />
        )}

        {/* Bottom gradient for readability */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-0 via-ink-0/50 to-transparent" />

        {/* Adult seal — a calligraphic 成 (seijin = "adult") pinned to
            the top-right when blurred. Much more legible than the real
            corner seals once the cover is muted; doubles as the signal
            "this is why the cover is hidden". */}
        {isMuted && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 text-center">
            <span className="font-jp text-5xl font-bold text-gold drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]">
              成
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-washi/80">
              {t("publicProfile.adultHidden")}
            </span>
          </div>
        )}

        {/* Corner seals — read-only, purely informative. Top-left
            cluster can stack: 成 (adult) takes priority on position
            left-2 when present; 限 (all-collector) shifts to left-8
            to sit beside it. 読 (fully-read) always owns top-right. */}
        {entry.is_adult && !isMuted && (
          <span
            className="absolute left-2 top-2 z-10 grid h-4 w-4 place-items-center rounded-sm bg-gold/85 text-ink-0 shadow"
            style={{ transform: "rotate(-4deg)" }}
            title={t("publicProfile.seriesAdult")}
          >
            <span className="font-jp text-[9px] font-bold leading-none">
              成
            </span>
          </span>
        )}
        {entry.all_collector && !isMuted && (
          <span
            className={`absolute top-2 z-10 grid h-4 w-4 place-items-center rounded-sm bg-gold/85 text-ink-0 shadow ${
              entry.is_adult ? "left-8" : "left-2"
            }`}
            style={{ transform: "rotate(-6deg)" }}
            title={t("publicProfile.seriesAllCollector")}
          >
            <span className="font-display text-[8px] font-bold leading-none">
              限
            </span>
          </span>
        )}
        {entry.fully_read && !isMuted && (
          <span
            className="absolute right-2 top-2 z-10 grid h-4 w-4 place-items-center rounded-sm bg-moegi/90 text-ink-0 shadow"
            style={{ transform: "rotate(4deg)" }}
            title={t("publicProfile.seriesFullyRead")}
          >
            <span className="font-jp text-[9px] font-bold leading-none">
              読
            </span>
          </span>
        )}

        {/* 願 Wishlist marker — the only top-right tag in the gallery
            (everything else uses the discreet 4×4 corner seals). The
            larger pill makes the wishlist rows reads as "tap me to
            give a gift" without the visitor having to compare counters
            across cards. Mutually exclusive with the 読 fully-read seal
            (a fully-read series owns volumes, so it can never be a
            wishlist), so no positional conflict on top-right. */}
        {isWishlist && !isMuted && (
          <div
            className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-sakura/55 bg-ink-0/65 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sakura shadow-[0_1px_3px_rgba(10,9,8,0.4)] backdrop-blur"
            aria-label={t("publicProfile.seriesWishlist")}
            title={t("publicProfile.seriesWishlist")}
          >
            <span
              aria-hidden="true"
              className="font-jp text-[11px] font-bold leading-none"
            >
              願
            </span>
            {t("manga.wishlist")}
          </div>
        )}

        {/* Bottom caption — hidden when the card is muted so the title
            doesn't defeat the blur. The adult sigil overlay above gives
            the visitor enough context to know why. */}
        {!isMuted && (
          <div className="absolute inset-x-0 bottom-0 p-3">
            <h3 className="font-display text-sm font-semibold leading-tight text-washi drop-shadow-md line-clamp-2">
              {entry.name}
            </h3>
            <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider">
              <span>
                {/* Counter colour follows the state ladder: sakura
                    when the shelf is still empty (wishlist), hanko
                    otherwise. Keeps "0" from reading as a danger-red
                    signal on the wishlist branch. */}
                <span
                  className={`tabular-nums ${
                    isWishlist ? "text-sakura" : "text-hanko-bright"
                  }`}
                >
                  {owned}
                </span>
                <span className="text-washi-dim tabular-nums">
                  {" "}
                  / {total || "?"}
                </span>
              </span>
              {!isWishlist && (
                <span className="text-moegi-muted tabular-nums">
                  {entry.read_percent}% 読
                </span>
              )}
            </div>
            {total > 0 && (
              <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-washi/15">
                {isWishlist ? (
                  /* Wishlist progress bar — dashed sakura at full
                     width, signalling intent without pretending
                     progress. Mirrors the dashboard's Manga card. */
                  <div
                    className="h-full w-full opacity-50"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(90deg, var(--sakura) 0 4px, transparent 4px 8px)",
                    }}
                    aria-hidden="true"
                  />
                ) : (
                  <div className="flex h-full w-full">
                    <div
                      className="h-full bg-moegi"
                      style={{ width: `${entry.read_percent}%` }}
                    />
                    <div
                      className="h-full bg-hanko/60"
                      style={{
                        width: `${Math.max(0, Math.round((owned / total) * 100) - entry.read_percent)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Loading state — skeleton masthead + skeleton grid. */
function GallerySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {[...Array(12)].map((_, i) => (
        <Skeleton.Card key={i} />
      ))}
    </div>
  );
}

/** Empty gallery — archivist hasn't added anything yet. */
function EmptyGallery() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-ink-1/30 px-6 py-20 text-center animate-fade-up">
      <div className="hanko-seal mb-4 grid h-16 w-16 place-items-center rounded-md font-display text-xl">
        空
      </div>
      <h2 className="font-display text-2xl italic text-washi">
        {t("publicProfile.emptyTitle")}
      </h2>
      <p className="mt-2 max-w-md text-sm text-washi-muted">
        {t("publicProfile.emptyBody")}
      </p>
    </div>
  );
}

/** 404 — no user owns that slug. */
function NotFoundState({ slug }) {
  const t = useT();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center animate-fade-up">
      <div className="hanko-seal mb-4 grid h-20 w-20 place-items-center rounded-md font-display text-2xl">
        無
      </div>
      <h1 className="font-display text-4xl font-light italic text-washi md:text-5xl">
        {t("publicProfile.notFoundTitle")}
      </h1>
      <p className="mt-3 max-w-md font-sans text-sm text-washi-muted">
        {t("publicProfile.notFoundBody", { slug })}
      </p>
      <Link
        to="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full border border-border bg-ink-1/60 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/50 hover:text-washi"
      >
        {t("publicProfile.backHome")}
      </Link>
    </div>
  );
}

/**
 * Gold-palette banner above the gallery when the archive contains
 * adult-tagged series. Sober, no red alarm — it's a qualitative advisory,
 * not a security warning. Clicking the action toggles the reveal state;
 * the label flips between "Afficher" and "Masquer".
 */
function AdultWarningBanner({ revealed, onToggle }) {
  const t = useT();
  return (
    <div
      className="my-6 flex flex-wrap items-center gap-4 rounded-xl border border-gold/40 bg-gradient-to-br from-gold/8 to-transparent px-5 py-4 animate-fade-up"
      style={{ animationDelay: "150ms" }}
      role="alert"
    >
      {/* Left kanji medallion */}
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-gold/50 bg-gold/15 font-jp text-lg font-bold text-gold"
        style={{ transform: "rotate(-3deg)" }}
      >
        成
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-muted">
          {t("publicProfile.adultBannerEyebrow")}
        </p>
        <p className="mt-0.5 font-display text-sm italic text-washi">
          {revealed
            ? t("publicProfile.adultBannerRevealed")
            : t("publicProfile.adultBannerHidden")}
        </p>
      </div>

      <button
        type="button"
        onClick={onToggle}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 font-mono text-[11px] uppercase tracking-wider transition ${
          revealed
            ? "border-border bg-ink-1/60 text-washi-muted hover:border-gold/40 hover:text-washi"
            : "border-gold/60 bg-gold/15 text-gold hover:bg-gold/25"
        }`}
      >
        {revealed
          ? t("publicProfile.adultBannerHide")
          : t("publicProfile.adultBannerReveal")}
      </button>
    </div>
  );
}

/** Turn an ISO "YYYY-MM" into "March 2026" / "mars 2026" per locale. */
function formatSince(iso) {
  try {
    const [y, m] = iso.split("-").map(Number);
    const d = new Date(y, (m ?? 1) - 1, 1);
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

/**
 * 祝 · Birthday-mode banner — quiet, celebratory ribbon shown when the
 * owner has armed the wishlist-exposure window. Sets the visitor's
 * expectations: some entries on the page are wished-for, not owned.
 *
 * Stays a single horizontal strip with sakura accent + countdown so it
 * communicates the temporary nature of the state without dominating
 * the gallery below.
 */
function BirthdayBanner({ until }) {
  const t = useT();
  const date = new Date(until);
  const remaining = Math.max(
    0,
    Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
  );
  if (remaining <= 0) return null;
  const formatted = (() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "long",
      }).format(date);
    } catch {
      return date.toISOString().slice(0, 10);
    }
  })();
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-sakura/45 bg-sakura/10 px-4 py-3 backdrop-blur animate-fade-up"
    >
      <span
        aria-hidden="true"
        className="font-jp text-2xl font-bold leading-none text-sakura"
      >
        祝
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-washi-dim">
          {t("publicProfile.birthdayKicker")}
        </p>
        <p className="mt-0.5 font-display text-sm italic text-washi md:text-base">
          {t("publicProfile.birthdayBody", {
            date: formatted,
            days: remaining,
          })}
        </p>
      </div>
    </div>
  );
}
