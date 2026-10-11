import { useT } from "@/i18n/index.jsx";
import { useAuth } from "@/hooks/useAuth.js";
import { getCachedUser } from "@/utils/auth.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import CoverImage from "@/components/ui/CoverImage.jsx";

/**
 * 表 · The landing page.
 *
 * Everything on it is either the product or a statement about the
 * product that is true of every deployment. There are no testimonials
 * (there were three, from people who did not exist), no borrowed
 * popularity (the hero used to show MyAnimeList's top 8 as if they were
 * a shelf, fetched from a third party on every anonymous visit), and no
 * decorative covers under someone else's copyright bundled into the
 * build.
 *
 * What replaced them:
 *
 *   • The hero shows the app. To a stranger, that is a spread of two real
 *     screenshots; on a device whose cache holds a shelf of your own, it
 *     is *your* shelf — the same covers the dashboard shows.
 *   • "The real thing" is four screenshots with plain captions.
 *   • "In plain terms" says what this is and what it is not, in claims
 *     that hold for anyone who deploys it.
 *
 * Screenshots ship as AVIF + WebP with a JPEG fallback at two widths;
 * every `<img>` carries its intrinsic size so the layout is settled
 * before the first byte arrives.
 */

// ── Screenshots ────────────────────────────────────────────────────
//
// `import.meta.glob` keeps the twenty asset imports out of the way. The
// files are hashed by Vite like any other import; nothing here is
// fetched at runtime from anywhere but our own origin.
const SCREEN_FILES = import.meta.glob("../assets/screens/*.{avif,webp,jpg}", {
  eager: true,
  query: "?url",
  import: "default",
});

function screenUrl(id, width, ext) {
  return SCREEN_FILES[`../assets/screens/${id}-${width}.${ext}`];
}

// All four sources are 2732 × 1800, resized to 1400 → 1400 × 922 and
// 800 → 800 × 527. The 1400 figure is what `<img width height>` carries.
const SCREEN_W = 1400;
const SCREEN_H = 922;

/** The four screens, in the order they are shown. `kanji` labels the chip. */
const SCREENS = [
  { id: "library", kanji: "本棚", key: "Library" },
  { id: "series", kanji: "作品", key: "Series" },
  { id: "volumes", kanji: "巻", key: "Volumes" },
  { id: "stats", kanji: "統計", key: "Stats" },
];

/** Fewer real series than this and the spread reads better than a shelf. */
const MIN_SHELF = 4;
const SHELF_SLOTS = 8;

/** Footer links: a 10px label, but a 44px hit area — and never split across lines. */
const FOOT_LINK =
  "inline-flex min-h-11 items-center whitespace-nowrap hover:text-washi";

export default function About() {
  const t = useT();
  // 誰 · The same answer the header and the tab bar act on. The route
  // used to hand this page App's `googleUser`, which only a protected
  // route ever sets — so a signed-in visitor who *landed* here was
  // greeted as a stranger until they had been somewhere else first.
  const { isAuthenticated: isAuthed, status } = useAuth();

  // Dexie is read either way (instant, no request); the network
  // revalidation only runs for a signed-in visitor. The shelf follows
  // the cache, not the session: the cache is stamped with the account
  // it was filled for and wiped on logout or on a foreign login
  // (`lib/owner.js`), so a shelf on this device is this visitor's own —
  // and it is there in milliseconds, before `/auth/user` has answered,
  // so a returning collector never sees the spread flash before their
  // covers. The call to action, by contrast, follows the session.
  const { data: library } = useLibrary({ enabled: isAuthed });
  // 鍵 · Whose shelf this may be. Signed in, or signed in as far as an
  // offline device can tell, or — while the probe is still out — a
  // device that remembers a signed-in profile. A device whose session
  // was answered with a 401 has neither the profile nor, since
  // `clearReadCaches`, the rows; this keeps the probe's own few
  // hundred milliseconds from drawing somebody else's covers for
  // whoever opened the page.
  const mayShowShelf =
    isAuthed || (status?.kind === "checking" && getCachedUser() != null);
  const shelf =
    mayShowShelf && library.length >= MIN_SHELF
      ? [...library]
          // Most recently touched first — "what you were just doing",
          // not the arbitrary MAL-id order the cache happens to hold.
          .sort((a, b) =>
            String(b.modified_on).localeCompare(String(a.modified_on)),
          )
          .slice(0, SHELF_SLOTS)
      : null;

  return (
    <div
      // 底 · `pb-nav` is the same bottom clearance every other page root
      // carries (20 of them) so the fixed mobile tab bar never covers
      // the last content. Conditional here — unlike those pages, the
      // landing is routinely visited signed-out, and the bar only
      // renders for an authenticated session; padding for a bar that
      // isn't there would leave a dead band under the footer.
      className={`relative isolate overflow-hidden grain min-h-[calc(100svh_-_4rem)] ${
        isAuthed ? "pb-nav md:pb-0" : ""
      }`.trim()}
    >
      {/* Ambient */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
      >
        <div
          className="absolute -top-1/2 left-1/2 h-[60rem] w-[60rem] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.6 0.22 25 / 0.25), transparent 60%)",
          }}
        />
      </div>

      {/* ─────────── Hero ─────────── */}
      <section className="relative px-4 sm:px-6">
        <div className="mx-auto max-w-6xl pt-12 md:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-ink-1/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] text-washi-muted backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hanko opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-hanko" />
              </span>
              {t("about.version")}
            </span>
            <h1
              data-ink-trail="true"
              className="mt-6 font-display text-5xl font-light leading-[0.95] tracking-tight text-washi md:text-7xl lg:text-8xl animate-fade-up"
            >
              {t("about.heroStart")}{" "}
              <em className="italic font-semibold text-hanko-gradient not-italic md:italic">
                {t("about.heroAccent")}
              </em>
              {t("about.heroEnd1")}
              <br />
              {t("about.heroEnd2")}{" "}
              <span className="inline-block text-ink-gradient">
                {t("about.heroArchived")}
              </span>
            </h1>
            <p
              className="mx-auto mt-6 max-w-xl text-base text-washi-muted md:text-lg animate-fade-up"
              style={{ animationDelay: "100ms" }}
            >
              {t("about.subHero")}
            </p>
            {/* Single primary CTA — destination & label depend on auth.
                Logged-out → "Get started" (→ /log-in). Logged-in → "Open
                dashboard" (→ /dashboard). One button, no mid-funnel
                hesitation. */}
            <div
              className="mt-8 flex justify-center animate-fade-up"
              style={{ animationDelay: "200ms" }}
            >
              <a
                href={isAuthed ? "/dashboard" : "/log-in"}
                className="group inline-flex items-center justify-center gap-2 rounded-full bg-hanko px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-on-hanko shadow-xl glow-red transition hover:scale-[1.02] hover:bg-hanko-deep active:scale-95"
              >
                {isAuthed ? t("about.openDashboard") : t("about.getStarted")}
                <ArrowIcon />
              </a>
            </div>
          </div>

          {/* Hero visual — the product, or the visitor's own shelf */}
          <div
            className="relative mx-auto mt-16 max-w-5xl animate-fade-up"
            style={{ animationDelay: "300ms" }}
          >
            <div className="pointer-events-none absolute -inset-20 -z-10 opacity-40 blur-3xl">
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse at 30% 50%, oklch(0.6 0.22 25 / 0.3), transparent 60%), radial-gradient(ellipse at 70% 50%, oklch(0.82 0.13 78 / 0.15), transparent 60%)",
                }}
              />
            </div>
            {shelf ? <OwnShelf shelf={shelf} t={t} /> : <Spread t={t} />}
          </div>
        </div>
      </section>

      {/* ─────────── Philosophy ─────────── */}
      <section className="relative px-4 py-16 sm:px-6 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-16">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko-bright">
                {t("about.philosophy")}
              </p>
              <h2 className="mt-3 font-display text-3xl font-light italic leading-tight text-washi md:text-5xl">
                {t("about.philosophyHeading1")}
                <br />
                <span className="text-hanko-gradient font-semibold not-italic">
                  {t("about.philosophyHeading2")}
                </span>
              </h2>
            </div>
            <div className="space-y-6 text-base text-washi-muted md:text-lg">
              <p>{t("about.philosophyBody1")}</p>
              {/* 信 · Three principles, numbered — the app's own, not a
                  quotation. The previous cut styled this line as a
                  pull-quote, which left the reader looking for who said
                  it. Nobody did; we mean it. */}
              <ol className="space-y-3 border-l-2 border-hanko/50 pl-5">
                {["credo1", "credo2", "credo3"].map((key, i) => (
                  <li key={key} className="flex items-baseline gap-4">
                    <span className="font-mono text-[10px] tracking-[0.25em] text-hanko-bright">
                      0{i + 1}
                    </span>
                    <span className="font-display text-lg text-washi md:text-xl">
                      {t(`about.${key}`)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Features ─────────── */}
      <section className="relative px-4 py-16 sm:px-6 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("about.featuresLabel")}
            </span>
            <h2 className="mt-2 font-display text-3xl font-semibold italic text-washi md:text-4xl">
              {t("about.featuresHeading")}
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <FeatureCard
                key={n}
                number={`0${n}`}
                title={t(`about.f${n}Title`)}
                description={t(`about.f${n}Body`)}
                accent={n === 2 || n === 6}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── The real thing ─────────── */}
      <section className="relative px-4 py-16 sm:px-6 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 max-w-2xl">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("about.seeLabel")}
            </span>
            <h2 className="mt-2 font-display text-3xl font-semibold italic text-washi md:text-4xl">
              {t("about.seeHeading")}
            </h2>
            <p className="mt-3 text-sm text-washi-muted md:text-base">
              {t("about.seeBody")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {SCREENS.map((screen) => (
              <ScreenCard key={screen.id} screen={screen} t={t} />
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── In plain terms ─────────── */}
      <section className="relative px-4 py-16 sm:px-6 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("about.natureLabel")}
            </span>
            <h2 className="mt-2 font-display text-3xl font-semibold italic text-washi md:text-4xl">
              {t("about.natureHeading1")}{" "}
              <span className="text-washi-dim font-light">
                {t("about.natureHeading2")}
              </span>
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Ledger
              kanji="是"
              tone="moegi"
              title={t("about.isTitle")}
              items={[1, 2, 3, 4, 5].map((n) => t(`about.is${n}`))}
            />
            <Ledger
              kanji="否"
              tone="hanko"
              title={t("about.isntTitle")}
              items={[1, 2, 3, 4, 5].map((n) => t(`about.isnt${n}`))}
            />
          </div>
        </div>
      </section>

      {/* ─────────── CTA ─────────── */}
      <section className="relative px-4 py-16 sm:px-6 md:py-24">
        <div className="mx-auto max-w-4xl">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-ink-1 via-hanko/10 to-gold/5 p-8 text-center md:p-16">
            {/* Ornamental Japanese character */}
            <span
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-display italic font-light text-hanko-bright/5 text-[20rem] leading-none select-none"
              aria-hidden="true"
            >
              始
            </span>
            <div className="relative">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko-bright">
                {t("about.begin")}
              </p>
              <h2 className="mt-3 font-display text-3xl font-light italic leading-tight text-washi md:text-5xl">
                {t("about.ctaHeading1")}{" "}
                <span className="font-semibold not-italic text-hanko-gradient">
                  {t("about.ctaHeading2")}
                </span>
              </h2>
              <p className="mx-auto mt-4 max-w-md text-sm text-washi-muted md:text-base">
                {t("about.ctaBody")}
              </p>
              <div className="mt-8">
                <a
                  href={isAuthed ? "/dashboard" : "/log-in"}
                  className="group inline-flex items-center gap-2 rounded-full bg-washi px-8 py-4 text-sm font-semibold uppercase tracking-wider text-ink-0 shadow-xl transition hover:scale-[1.02] active:scale-95"
                >
                  {isAuthed
                    ? t("about.openDashboard")
                    : t("about.startCollecting")}
                  <ArrowIcon />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Footer ─────────── */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <span className="hanko-seal grid h-7 w-7 place-items-center rounded-md font-display text-[9px] font-bold">
              MC
            </span>
            <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("about.footerYear", { year: new Date().getFullYear() })}
            </p>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            <a className={FOOT_LINK} href="/dashboard">
              Dashboard
            </a>
            <a className={FOOT_LINK} href="/glossary">
              <span aria-hidden="true" className="font-jp text-xs">
                字典
              </span>
              <span className="ml-1.5">{t("about.footerGlossary")}</span>
            </a>
            <a className={FOOT_LINK} href="/aide">
              <span aria-hidden="true" className="font-jp text-xs">
                助
              </span>
              <span className="ml-1.5">{t("about.footerHelp")}</span>
            </a>
            <a
              className={FOOT_LINK}
              href="https://github.com/Dim145/MangaCollector"
              rel="noopener noreferrer"
            >
              <span aria-hidden="true" className="font-jp text-xs">
                源
              </span>
              <span className="ml-1.5">{t("about.footerSource")}</span>
            </a>
            {!isAuthed && (
              <a className={FOOT_LINK} href="/log-in">
                {t("about.footerSignIn")}
              </a>
            )}
          </nav>
        </div>
      </footer>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 transition-transform group-hover:translate-x-1"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/**
 * One screenshot as a responsive `<picture>`. AVIF first, WebP second,
 * JPEG for whatever is left; two widths so a phone never downloads the
 * 1400-pixel cut.
 */
function Screenshot({
  id,
  alt,
  sizes,
  loading = "lazy",
  fetchPriority = "auto",
}) {
  return (
    <picture>
      <source
        type="image/avif"
        srcSet={`${screenUrl(id, 800, "avif")} 800w, ${screenUrl(id, 1400, "avif")} 1400w`}
        sizes={sizes}
      />
      <source
        type="image/webp"
        srcSet={`${screenUrl(id, 800, "webp")} 800w, ${screenUrl(id, 1400, "webp")} 1400w`}
        sizes={sizes}
      />
      <img
        src={screenUrl(id, 1400, "jpg")}
        alt={alt}
        width={SCREEN_W}
        height={SCREEN_H}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
        className="block h-auto w-full"
      />
    </picture>
  );
}

/**
 * A small mono label with a kanji, pinned to a screenshot's *lower* corner
 * — the upper one is where the app's own wordmark sits in every capture,
 * and a label over a logo reads as clutter.
 */
function ScreenChip({ kanji, children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-ink-0/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted backdrop-blur ${className}`}
    >
      <span aria-hidden="true" className="font-jp text-xs text-hanko-bright">
        {kanji}
      </span>
      {children}
    </span>
  );
}

/**
 * 頁 · The signed-out hero: two real screens laid like an open ledger —
 * the library across the spread, the series page riding its corner. The
 * tilt is a static transform, so it holds under reduced motion; only
 * the entrance fades.
 */
function Spread({ t }) {
  return (
    <div className="relative pb-10 md:pb-16">
      <figure className="relative -rotate-[1.2deg] overflow-hidden rounded-xl border border-border bg-ink-1 shadow-2xl md:mr-[24%]">
        <Screenshot
          id="library"
          alt={t("about.screenLibraryAlt")}
          sizes="(min-width: 1024px) 780px, 100vw"
          loading="eager"
          fetchPriority="high"
        />
        <figcaption className="absolute bottom-3 left-3">
          <ScreenChip kanji="本棚">{t("about.screenLibraryTitle")}</ScreenChip>
        </figcaption>
      </figure>
      <figure className="absolute -bottom-2 right-0 hidden w-[46%] rotate-[1.4deg] overflow-hidden rounded-xl border border-border bg-ink-1 shadow-2xl md:block">
        <Screenshot
          id="series"
          alt={t("about.screenSeriesAlt")}
          sizes="(min-width: 1024px) 480px, 46vw"
        />
        <figcaption className="absolute bottom-3 left-3">
          <ScreenChip kanji="作品">{t("about.screenSeriesTitle")}</ScreenChip>
        </figcaption>
      </figure>
    </div>
  );
}

/**
 * 棚 · The signed-in hero: the visitor's own covers, the same images the
 * dashboard shows, in the eight-slot rail the old carousel used — with
 * a caption that says so. Nothing here is anyone else's shelf.
 */
function OwnShelf({ shelf, t }) {
  return (
    <div>
      <div className="grid grid-cols-4 gap-3 md:grid-cols-8">
        {shelf.map((m, i) => (
          <div
            key={m.id ?? m.mal_id ?? i}
            className={`relative aspect-[2/3] overflow-hidden rounded-lg border border-border bg-ink-1 shadow-2xl transition-transform duration-500 hover:-translate-y-2 hover:scale-105 ${
              i % 2 === 0 ? "md:translate-y-2" : "md:-translate-y-2"
            }`}
          >
            <CoverImage
              src={m.image_url_jpg}
              sizes="(min-width: 768px) 120px, 23vw"
              alt={m.name}
              paletteSeed={m.name}
              loading={i < 4 ? "eager" : "lazy"}
              priority={i < 2}
              lcpHintRank={i < 2 ? i : undefined}
              className="h-full w-full"
            />
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-0 via-transparent to-transparent"
              aria-hidden="true"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 p-1.5">
              <p className="line-clamp-1 font-display text-[10px] font-semibold text-washi drop-shadow">
                {m.name}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-washi-dim">
        {t("about.shelfCaption", { count: shelf.length })}
      </p>
    </div>
  );
}

/** A screenshot with its caption, for "the real thing". */
function ScreenCard({ screen, t }) {
  const { id, kanji, key } = screen;
  return (
    <figure className="group overflow-hidden rounded-2xl border border-border bg-ink-1/50 transition hover:-translate-y-0.5 hover:border-border/80">
      <div className="relative border-b border-border bg-ink-0">
        <Screenshot
          id={id}
          alt={t(`about.screen${key}Alt`)}
          sizes="(min-width: 1024px) 560px, (min-width: 640px) 50vw, 100vw"
        />
      </div>
      <figcaption className="flex items-start gap-4 p-5">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-ink-2/60 font-jp text-sm font-bold text-hanko-bright"
        >
          {kanji}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-washi">
            {t(`about.screen${key}Title`)}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-washi-muted">
            {t(`about.screen${key}Body`)}
          </p>
        </div>
      </figcaption>
    </figure>
  );
}

/**
 * 帳 · One column of "in plain terms". `tone` picks the mark: moegi —
 * the palette's "completed" green — for what it is, hanko red for what
 * it is not. The mark is drawn, not typed, so it reads the same in every
 * font and is invisible to a screen reader, which gets the list itself.
 */
function Ledger({ kanji, tone, title, items }) {
  const isYes = tone === "moegi";
  const chip = isYes
    ? "border-moegi/40 bg-moegi/10 text-moegi"
    : "border-hanko/40 bg-hanko/10 text-hanko-bright";
  const mark = isYes ? "text-moegi" : "text-hanko-bright";
  return (
    <div className="rounded-2xl border border-border bg-ink-1/50 p-6">
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`grid h-9 w-9 place-items-center rounded-md border font-jp text-base font-bold ${chip}`}
        >
          {kanji}
        </span>
        <h3 className="font-display text-xl font-semibold text-washi">
          {title}
        </h3>
      </div>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-3 py-3 text-sm leading-relaxed text-washi-muted"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`mt-1 h-3.5 w-3.5 shrink-0 ${mark}`}
              aria-hidden="true"
            >
              {isYes ? (
                <polyline points="3 8.5 6.5 12 13 4.5" />
              ) : (
                <line x1="3" y1="8" x2="13" y2="8" />
              )}
            </svg>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureCard({ number, title, description, accent }) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border p-6 transition hover:-translate-y-0.5 ${
        accent
          ? "border-hanko/30 bg-gradient-to-br from-hanko/10 to-transparent hover:border-hanko/50"
          : "border-border bg-ink-1/50 hover:border-border/80"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span
          className={`font-mono text-xs font-semibold ${
            accent ? "text-hanko-bright" : "text-washi-dim"
          }`}
        >
          {number}
        </span>
        <span className="h-px flex-1 ml-4 bg-gradient-to-r from-border to-transparent" />
      </div>
      <h3 className="mt-3 font-display text-xl font-semibold text-washi">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-washi-muted">
        {description}
      </p>
    </div>
  );
}
