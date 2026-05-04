/**
 * 友 · Tomo insights — social-graph overlap rendered as two
 * complementary cards:
 *
 *   - SharedHero   : the single most-shared series (you own it,
 *                    N friends own it too).
 *   - LatentRail   : recommendations rail — series friends own
 *                    that you don't yet.
 *
 * Online-only. The parent gates this section behind `useOnline`
 * and shows an OfflinePanel-style takeover when the network is
 * down; here we trust the page to never mount us in that state.
 */
import { Link } from "react-router-dom";
import CoverImage from "../ui/CoverImage.jsx";

export default function FriendsInsights({ overlap, t, loading }) {
  if (loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-ink-1/40" />
        <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-ink-1/40" />
      </div>
    );
  }
  const noFriends = (overlap?.friend_total ?? 0) === 0;
  if (noFriends) {
    return (
      <article className="rounded-2xl border border-dashed border-border/70 bg-ink-1/30 px-6 py-10 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-muted">
          {t("stats.tomo.empty.eyebrow")}
        </p>
        <p className="mt-2 font-display text-lg italic text-washi-muted">
          {t("stats.tomo.empty.body")}
        </p>
        <Link
          to="/friends"
          className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-washi transition hover:text-hanko"
        >
          {t("stats.tomo.empty.cta")} →
        </Link>
      </article>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] lg:gap-6">
      <SharedHero
        top={overlap?.shared?.[0]}
        friendTotal={overlap?.friend_total ?? 0}
        t={t}
      />
      <LatentRail latent={overlap?.latent ?? []} friendTotal={overlap?.friend_total ?? 0} t={t} />
    </div>
  );
}

function SharedHero({ top, friendTotal, t }) {
  if (!top) {
    return (
      <article className="rounded-2xl border border-dashed border-border/70 bg-ink-1/30 px-6 py-10 text-center font-display italic text-washi-muted">
        {t("stats.tomo.sharedEmpty")}
      </article>
    );
  }
  return (
    <Link
      to={`/mangapage?mal_id=${top.mal_id}`}
      className="group relative isolate flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-ink-1/55 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-washi/50 hover:shadow-[0_22px_36px_-22px_rgba(245,239,225,0.25)]"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-ink-2/60">
        {top.image_url ? (
          <CoverImage
            src={top.image_url}
            alt=""
            className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-jp text-7xl font-bold text-washi/30">
            友
          </div>
        )}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-1/95 via-ink-1/80 to-transparent"
        />
        {/* Friend-count stamp, top-right hanko style. */}
        <span
          aria-hidden="true"
          className="absolute right-3 top-3 inline-flex items-baseline gap-1 rounded-md border border-washi/60 bg-ink-1/90 px-3 py-1 font-display italic shadow-[0_6px_18px_-6px_rgba(0,0,0,0.6)]"
        >
          <span className="font-jp text-base font-bold not-italic text-hanko">
            友
          </span>
          <span className="font-display text-lg leading-none text-washi">
            {top.friend_count}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-washi-muted">
            / {friendTotal}
          </span>
        </span>
      </div>

      <div className="relative flex flex-1 flex-col gap-2 p-5 md:p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-muted">
          {t("stats.tomo.sharedEyebrow")}
        </p>
        <h3 className="font-display text-2xl font-light italic leading-tight text-washi md:text-3xl">
          {top.name}
        </h3>
        <p className="font-display text-[12px] italic text-washi-muted md:text-[13px]">
          {t("stats.tomo.sharedHint", {
            n: top.friend_count,
            total: friendTotal,
          })}
        </p>
      </div>
    </Link>
  );
}

function LatentRail({ latent, friendTotal, t }) {
  if (!latent.length) {
    return (
      <article className="rounded-2xl border border-dashed border-border/70 bg-ink-1/30 px-6 py-10 text-center font-display italic text-washi-muted">
        {t("stats.tomo.latentEmpty")}
      </article>
    );
  }
  return (
    <article className="rounded-2xl border border-border/70 bg-ink-1/55 p-5 backdrop-blur-sm md:p-6">
      <header className="mb-4 flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-washi-muted">
          {t("stats.tomo.latentEyebrow")}
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
          {t("stats.tomo.latentCount", { n: latent.length })}
        </span>
      </header>

      <ol className="grid gap-3 sm:grid-cols-2">
        {latent.slice(0, 6).map((entry) => (
          <li key={entry.mal_id}>
            <LatentRow entry={entry} friendTotal={friendTotal} t={t} />
          </li>
        ))}
      </ol>

      {latent.length > 6 ? (
        <p className="mt-4 text-right font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
          {t("stats.tomo.latentMore", { n: latent.length - 6 })}
        </p>
      ) : null}
    </article>
  );
}

function LatentRow({ entry, friendTotal, t }) {
  return (
    <Link
      to={`/mangapage?mal_id=${entry.mal_id}`}
      className="group flex items-center gap-3 rounded-xl border border-border/60 bg-ink-2/30 p-2.5 transition hover:border-washi/40 hover:bg-ink-2/55"
    >
      <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-border/70 bg-ink-2">
        {entry.image_url ? (
          <CoverImage
            src={entry.image_url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center font-jp text-base font-bold text-hanko/40">
            巻
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm italic text-washi md:text-base">
          {entry.name}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
          {t("stats.tomo.latentRowHint", {
            n: entry.friend_count,
            total: friendTotal,
          })}
        </p>
      </div>
    </Link>
  );
}
