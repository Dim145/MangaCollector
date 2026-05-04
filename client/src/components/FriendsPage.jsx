import { useMemo } from "react";
import { Link } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import {
  useFollowList,
  useFriendsFeed,
  useUnfollow,
} from "@/hooks/useFriends.js";
import { useOnline } from "@/hooks/useOnline.js";
import { useT, useLang } from "@/i18n/index.jsx";
import { formatTime, localeFor } from "@/utils/date.js";

/**
 * 友 Tomo · Friends correspondence page.
 *
 * Aesthetic — an archivist's mailbox: each followed person is a
 * correspondent (left rail, like a row of pigeon-holes), each
 * activity event from them is a postcard or telegram entry in the
 * feed (right column, vertical thread). Day separators are
 * brushstrokes with the day kanji 日 anchored on them; events
 * within a day stack as inscribed lines with the actor's hanko
 * pressed on the left margin.
 *
 * On mobile the two columns stack: correspondents collapse into a
 * horizontal scroll-snap rail at the top; the feed reads vertically
 * underneath.
 */
export default function FriendsPage() {
  const t = useT();
  const lang = useLang();
  // 連 · Connectivity gate. The whole correspondence feature is
  // network-bound: follow list, activity feed, follow/unfollow
  // mutations all need a live server. There's no useful offline
  // mode (we don't cache cross-user data — privacy + freshness
  // both argue against it), so we surface a single "unavailable"
  // panel rather than a silent empty page that could be misread
  // as "you have no friends" or "they posted nothing".
  const online = useOnline();
  const { data: follows = [], isLoading: loadingFollows } = useFollowList();
  const { data: feed = [], isLoading: loadingFeed } = useFriendsFeed(80);

  // Group feed entries by calendar day (UTC) so the brushstroke
  // day-separators only render when the date actually changes.
  const groups = useMemo(() => groupByDay(feed, lang), [feed, lang]);

  return (
    <DefaultBackground>
      <div className="relative mx-auto max-w-6xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* Atmosphere — diagonal warmth: hanko top-left + gold
            bottom-right, like sunlight through a side window. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 -top-32 -z-10 h-96 w-96 rounded-full bg-hanko/10 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 bottom-12 -z-10 h-80 w-80 rounded-full bg-gold/10 blur-3xl"
        />
        <CornerKanji />

        <Hero count={follows.length} t={t} />

        {!online ? (
          // 連 · Offline mode keeps the correspondents rail visible
          // (cached in Dexie by `useFollowList`) so users still see
          // who they follow. Only the activity feed and follow CTA
          // are gated — those need fresh server data.
          <div className="grid grid-cols-1 gap-8 md:grid-cols-[280px_minmax(0,1fr)] md:gap-10 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-12">
            <aside className="md:sticky md:top-8 md:self-start">
              <CorrespondentsPanel
                follows={follows}
                loading={loadingFollows}
                t={t}
                lang={lang}
              />
            </aside>
            <section>
              <OfflinePanel t={t} />
            </section>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-[280px_minmax(0,1fr)] md:gap-10 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-12">
            {/* Left rail — correspondents (the people you follow) */}
            <aside className="md:sticky md:top-8 md:self-start">
              <CorrespondentsPanel
                follows={follows}
                loading={loadingFollows}
                t={t}
                lang={lang}
              />
            </aside>

            {/* Right column — chronological correspondence feed */}
            <section>
              <FeedHeader count={feed.length} t={t} />
              {loadingFeed && feed.length === 0 ? (
                <FeedLoading t={t} />
              ) : groups.length === 0 ? (
                <FeedEmpty hasFollows={follows.length > 0} t={t} />
              ) : (
                <FeedThread groups={groups} t={t} lang={lang} />
              )}
            </section>
          </div>
        )}

        <footer className="mt-12 text-center md:mt-16">
          <Link
            to="/dashboard"
            className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim transition hover:text-washi"
          >
            <span className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            {t("friends.backToDashboard")}
          </Link>
        </footer>
      </div>
    </DefaultBackground>
  );
}

/**
 * 連 · Offline takeover panel for the FriendsPage.
 *
 * Aesthetic — a sealed envelope returned to sender. The kanji 圏
 * (out-of-zone) is anchored over a hanko-red wax seal, the body
 * explains *why* the page is empty (the postal route is closed,
 * not "you have no friends"), and a single retry CTA invites the
 * user to come back online. No CTA actions: even a "retry" would
 * just re-fire the disabled queries; we leave the user agent's
 * own connectivity restoration handle the recovery.
 */
function OfflinePanel({ t }) {
  return (
    <div className="mx-auto max-w-2xl rounded-md border border-moegi/40 bg-ink-1/40 p-12 text-center backdrop-blur md:p-16 animate-fade-up">
      {/* Wax seal — the 圏 kanji pressed in a hanko ring */}
      <div className="relative mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full border-2 border-moegi/50 bg-moegi/10 shadow-[0_0_24px_rgba(163,201,97,0.25)]">
        <span
          aria-hidden="true"
          className="font-jp text-4xl font-bold leading-none text-moegi"
          style={{ transform: "rotate(-6deg)" }}
        >
          圏
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 rounded-full ring-1 ring-inset ring-moegi/20"
        />
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-moegi">
        {t("friends.offlineKicker")}
      </p>
      <h2 className="mt-3 font-display text-2xl font-light italic leading-tight text-washi md:text-3xl">
        {t("friends.offlineTitle")}
      </h2>
      <p className="mx-auto mt-4 max-w-md font-display text-sm italic leading-relaxed text-washi-muted">
        {t("friends.offlineBody")}
      </p>

      {/* Brushstroke + secondary line — explains what specifically
          is out of reach (the page is empty for a *reason*, not
          because the user has no friends) */}
      <span
        aria-hidden="true"
        className="mx-auto my-5 block h-px w-24 bg-gradient-to-r from-transparent via-moegi/40 to-transparent"
      />
      <p className="mx-auto max-w-md font-mono text-[11px] leading-relaxed text-washi-dim">
        {t("friends.offlineHint")}
      </p>
    </div>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────

function Hero({ count, t }) {
  return (
    <header className="relative mb-10 animate-fade-up md:mb-14">
      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
          {t("friends.kicker")}
        </span>
        <span className="font-jp text-[11px] tracking-[0.4em] text-hanko/80">
          友
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent" />
        <span className="font-mono text-[11px] tabular-nums uppercase tracking-[0.22em] text-washi-dim">
          {count}{" "}
          {count === 1
            ? t("friends.correspondentSingular")
            : t("friends.correspondentPlural")}
        </span>
      </div>

      <h1
        data-ink-trail="true"
        className="font-display text-5xl font-light italic leading-[0.95] tracking-tight text-washi md:text-6xl lg:text-7xl"
      >
        <span className="text-hanko-gradient font-semibold not-italic">
          {t("friends.title")}
        </span>
      </h1>
      <p className="mt-4 max-w-xl font-display text-lg font-light italic leading-snug text-washi-muted md:text-xl">
        {t("friends.subtitle")}
      </p>
    </header>
  );
}

// ─── Correspondents rail (left) ────────────────────────────────────

function CorrespondentsPanel({ follows, loading, t, lang }) {
  const unfollow = useUnfollow();
  return (
    <div className="rounded-md border border-border/70 bg-ink-1/40 p-4 backdrop-blur md:p-5">
      <header className="mb-4 flex items-baseline gap-3 border-b border-border/60 pb-3">
        <span aria-hidden="true" className="font-jp text-base font-bold text-hanko-bright">
          通
        </span>
        <h2 className="font-display text-base font-semibold italic text-washi">
          {t("friends.correspondentsTitle")}
        </h2>
      </header>

      {loading && follows.length === 0 ? (
        <ul className="space-y-3" aria-label={t("common.loading")}>
          {Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-md border border-border/40 bg-ink-2/30 p-3"
            >
              <span className="block h-9 w-9 rounded-full bg-ink-2/60" />
              <div className="flex-1 space-y-1.5">
                <span className="block h-3 w-3/4 rounded bg-ink-2/60" />
                <span className="block h-2.5 w-1/2 rounded bg-ink-2/40" />
              </div>
            </li>
          ))}
        </ul>
      ) : follows.length === 0 ? (
        <div className="px-2 py-6 text-center">
          <p
            aria-hidden="true"
            className="font-jp text-4xl font-bold leading-none text-washi-dim/40"
          >
            無
          </p>
          <p className="mt-3 font-display text-sm italic text-washi-muted">
            {t("friends.correspondentsEmpty")}
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
            {t("friends.correspondentsEmptyHint")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {follows.map((f, i) => (
            <li
              key={f.user_id}
              className="animate-fade-up"
              style={{ animationDelay: `${100 + i * 50}ms` }}
            >
              <CorrespondentRow
                follow={f}
                onUnfollow={() => unfollow.mutate(f.public_slug)}
                lang={lang}
                t={t}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CorrespondentRow({ follow, onUnfollow, lang, t }) {
  const initial = (follow.display_name ?? follow.public_slug ?? "?")
    .trim()
    .charAt(0)
    .toUpperCase();
  const since = formatRelative(follow.followed_at, lang, t);
  return (
    <div className="group relative flex items-center gap-3 rounded-md border border-border/40 bg-ink-2/30 px-3 py-2.5 transition hover:border-gold/40 hover:bg-ink-2/50">
      <Link
        to={`/u/${follow.public_slug}`}
        className="flex flex-1 items-center gap-3 min-w-0"
      >
        {/* Hanko-style portrait — initial pressed in a circular
            stamp. Functions as a low-cost avatar: identifiable per
            user (color hash) without needing image plumbing. */}
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-hanko/40 bg-ink-1 font-display text-base font-semibold italic text-hanko-bright shadow-inner"
          style={{ transform: "rotate(-3deg)" }}
        >
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-sm italic leading-tight text-washi">
            {follow.display_name ?? `@${follow.public_slug}`}
          </p>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-washi-dim">
            @{follow.public_slug} · {since}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={onUnfollow}
        className="shrink-0 rounded-md border border-transparent px-2 py-1 font-mono text-[9px] uppercase tracking-[0.22em] text-washi-dim opacity-0 transition hover:border-hanko/50 hover:bg-hanko/10 hover:text-hanko-bright group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={t("friends.unfollowAria", {
          name: follow.display_name ?? follow.public_slug,
        })}
      >
        {t("friends.unfollow")}
      </button>
    </div>
  );
}

// ─── Feed (right) ──────────────────────────────────────────────────

function FeedHeader({ count, t }) {
  return (
    <header className="mb-6 flex items-baseline gap-3">
      <span aria-hidden="true" className="font-jp text-2xl font-bold text-hanko-bright">
        便
      </span>
      <h2 className="font-display text-xl font-semibold italic text-washi md:text-2xl">
        {t("friends.feedTitle")}
      </h2>
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent" />
      <span className="font-mono text-[11px] tabular-nums uppercase tracking-[0.22em] text-washi-dim">
        {count}{" "}
        {count === 1 ? t("friends.eventSingular") : t("friends.eventPlural")}
      </span>
    </header>
  );
}

function FeedThread({ groups, t, lang }) {
  return (
    <ol className="relative space-y-12">
      {groups.map((group, gi) => (
        <li key={group.key} className="animate-fade-up" style={{ animationDelay: `${100 + gi * 50}ms` }}>
          <DaySeparator label={group.label} />
          <ul className="mt-4 space-y-4">
            {group.entries.map((entry, ei) => (
              <li
                key={entry.event_id}
                className="animate-fade-up"
                style={{ animationDelay: `${gi * 50 + ei * 30}ms` }}
              >
                <FeedEntryCard entry={entry} t={t} lang={lang} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function DaySeparator({ label }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="font-jp text-base font-bold text-hanko/70">
        日
      </span>
      <span className="font-display text-sm italic tracking-wide text-washi">
        {label}
      </span>
      <Brushstroke className="ml-2 flex-1" />
    </div>
  );
}

function FeedEntryCard({ entry, t, lang }) {
  const initial = (entry.actor_display_name ?? entry.actor_slug ?? "?")
    .trim()
    .charAt(0)
    .toUpperCase();
  const time = formatTime(entry.created_at, lang);
  const message = describeEvent(entry, t);
  const actorLabel = entry.actor_display_name ?? `@${entry.actor_slug}`;

  return (
    <article className="tomo-letter group relative flex gap-4 rounded-md border border-border/70 bg-ink-1/40 p-4 transition hover:border-gold/35">
      {/* Hanko stamp anchored on the left edge — the actor's
          identity sealed onto the correspondence. The kanji in
          the centre is the seal kanji (see eventKanji map below).
          Subtle rotation so the stamp doesn't read as machine-set. */}
      <span
        aria-hidden="true"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-hanko/45 bg-hanko/5 font-jp text-xl font-bold leading-none text-hanko-bright shadow-inner"
        style={{ transform: "rotate(-3deg)" }}
      >
        {initial}
      </span>

      <div className="min-w-0 flex-1">
        <header className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            to={`/u/${entry.actor_slug}`}
            className="font-display text-sm font-semibold italic text-washi transition hover:text-hanko-bright"
          >
            {actorLabel}
          </Link>
          <span aria-hidden="true" className="font-jp text-[11px] not-italic text-hanko/70">
            {eventKanji[entry.event_type] ?? "便"}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
            {time}
          </span>
        </header>
        <p className="font-display text-[15px] italic leading-snug text-washi-muted">
          {message}
        </p>
      </div>
    </article>
  );
}

function FeedEmpty({ hasFollows, t }) {
  return (
    <div className="rounded-md border border-border/70 bg-ink-1/40 p-10 text-center backdrop-blur md:p-14">
      <p
        aria-hidden="true"
        className="font-jp text-6xl font-bold leading-none text-washi-dim md:text-8xl"
      >
        無
      </p>
      <h3 className="mt-5 font-display text-lg font-light italic text-washi md:text-xl">
        {hasFollows ? t("friends.feedEmptyTitleQuiet") : t("friends.feedEmptyTitleNone")}
      </h3>
      <p className="mt-3 max-w-md mx-auto font-display text-sm italic text-washi-muted">
        {hasFollows ? t("friends.feedEmptyBodyQuiet") : t("friends.feedEmptyBodyNone")}
      </p>
    </div>
  );
}

function FeedLoading({ t }) {
  return (
    <ol aria-label={t("common.loading")} className="space-y-12">
      {Array.from({ length: 2 }).map((_, gi) => (
        <li key={gi} className="animate-fade-up" style={{ animationDelay: `${gi * 60}ms` }}>
          <div className="flex items-center gap-3">
            <span className="block h-3 w-32 rounded bg-ink-2/60" />
            <span className="h-px flex-1 bg-border/60" />
          </div>
          <ul className="mt-4 space-y-4">
            {Array.from({ length: 3 }).map((_, ei) => (
              <li
                key={ei}
                className="flex gap-4 rounded-md border border-border/60 bg-ink-1/30 p-4"
              >
                <span className="block h-12 w-12 shrink-0 rounded-md bg-ink-2/60" />
                <div className="flex-1 space-y-2">
                  <span className="block h-3 w-40 rounded bg-ink-2/60" />
                  <span className="block h-3 w-3/4 rounded bg-ink-2/40" />
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

// ─── Decorative ────────────────────────────────────────────────────

function Brushstroke({ className = "" }) {
  return (
    <svg
      viewBox="0 0 800 8"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`h-1.5 w-full ${className}`}
    >
      <defs>
        <linearGradient id="tomo-brush" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--hanko)" stopOpacity="0.8" />
          <stop offset="55%" stopColor="var(--gold)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M2,4 Q160,1 320,4 T640,5 T798,3"
        stroke="url(#tomo-brush)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function CornerKanji() {
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-2 right-3 hidden -z-10 font-jp text-9xl font-bold leading-none text-hanko/[0.04] md:block"
        style={{ transform: "rotate(8deg)" }}
      >
        友
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-12 left-2 hidden -z-10 font-jp text-9xl font-bold leading-none text-gold/[0.05] md:block"
        style={{ transform: "rotate(-8deg)" }}
      >
        書
      </span>
    </>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

const eventKanji = {
  series_added: "入",
  series_removed: "去",
  series_completed: "完",
  volume_owned: "得",
  volume_unowned: "離",
  // Match the server's `event_types::MILESTONE_VOLUMES` /
  // `MILESTONE_SERIES` constants (noun-noun ordering, not
  // verb-noun). Misalignment here makes the i18n key lookup miss
  // and the feed line falls through to the generic fallback.
  milestone_volumes: "百",
  milestone_series: "新",
};

/** Render a feed entry as a one-liner, leaning on i18n strings. */
function describeEvent(entry, t) {
  const series = entry.series_name ?? t("friends.unknownSeries");
  const vol = entry.vol_num ?? "?";
  const count = entry.volume_count ?? 0;
  const key = `friends.event.${entry.event_type}`;
  const fallback = t("friends.event.fallback", {
    type: entry.event_type,
    series,
  });
  const text = t(key, { series, vol, count });
  return text === key ? fallback : text;
}

function groupByDay(feed, lang) {
  const groups = [];
  let current = null;
  for (const entry of feed) {
    const d = new Date(entry.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!current || current.key !== key) {
      current = {
        key,
        label: d.toLocaleDateString(localeFor(lang), {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
        entries: [],
      };
      groups.push(current);
    }
    current.entries.push(entry);
  }
  return groups;
}

/**
 * 友 · "Followed since" relative formatter — has its own copy because
 * the labels are translated via the SPA's i18n bundle (today / N days
 * ago / N months ago) rather than `Intl.RelativeTimeFormat`. Falls
 * back to "Mar 2026" style for older follows.
 */
function formatRelative(iso, lang, t) {
  try {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return t("friends.followedToday");
    if (days < 30) return t("friends.followedDaysAgo", { n: days });
    const months = Math.floor(days / 30);
    if (months < 12) return t("friends.followedMonthsAgo", { n: months });
    return d.toLocaleDateString(localeFor(lang), {
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}
