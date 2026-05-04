import { useContext, useEffect, useState } from "react";
import { useT } from "@/i18n/index.jsx";
// Each cover ships in AVIF, WebP, and JPEG; the <picture> element in
// the render below picks the smallest format the browser supports.
import PunpunAvif from "../assets/punpun.avif";
import PunpunWebp from "../assets/punpun.webp";
import PunpunJpg from "../assets/punpun.jpg";
import BerserkAvif from "../assets/berserk.avif";
import BerserkWebp from "../assets/berserk.webp";
import BerserkJpg from "../assets/berserk.jpg";
import BeastarsAvif from "../assets/beastars.avif";
import BeastarsWebp from "../assets/beastars.webp";
import BeastarsJpg from "../assets/beastars.jpg";
import TokyoGhoulAvif from "../assets/tokyoghoul.avif";
import TokyoGhoulWebp from "../assets/tokyoghoul.webp";
import TokyoGhoulJpg from "../assets/tokyoghoul.jpg";
import VinlandAvif from "../assets/vinland.avif";
import VinlandWebp from "../assets/vinland.webp";
import VinlandJpg from "../assets/vinland.jpg";
import FirePunchAvif from "../assets/firepunch.avif";
import FirePunchWebp from "../assets/firepunch.webp";
import FirePunchJpg from "../assets/firepunch.jpg";

const FirePunch = { avif: FirePunchAvif, webp: FirePunchWebp, jpg: FirePunchJpg };
const Punpun = { avif: PunpunAvif, webp: PunpunWebp, jpg: PunpunJpg };
const TokyoGhoul = { avif: TokyoGhoulAvif, webp: TokyoGhoulWebp, jpg: TokyoGhoulJpg };
const Berserk = { avif: BerserkAvif, webp: BerserkWebp, jpg: BerserkJpg };
const Vinland = { avif: VinlandAvif, webp: VinlandWebp, jpg: VinlandJpg };
const Beastars = { avif: BeastarsAvif, webp: BeastarsWebp, jpg: BeastarsJpg };
import SettingsContext from "@/SettingsContext.js";

const MOCKED = [
  { id: 1, title: "Fire Punch", volumes: 8, img: FirePunch },
  { id: 2, title: "Goodnight Punpun", volumes: 13, img: Punpun },
  { id: 3, title: "Tokyo Ghoul", volumes: 14, img: TokyoGhoul },
  { id: 4, title: "Berserk", volumes: 41, img: Berserk },
  { id: 5, title: "Vinland Saga", volumes: 27, img: Vinland },
  { id: 6, title: "Beastars", volumes: 22, img: Beastars },
];

export default function About({ googleUser } = {}) {
  const [topMangas, setTopMangas] = useState(MOCKED);
  const { authName } = useContext(SettingsContext);
  const t = useT();
  // The hero CTA used to render two near-identical buttons (Get Started +
  // Open Dashboard) regardless of auth state. For a logged-out visitor both
  // routes funnel to /log-in — the choice was theatre. For a returning,
  // already-signed-in user, "Get Started" is misleading. We collapse to a
  // single primary action whose label and destination track the actual
  // session.
  const isAuthed = Boolean(googleUser);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(
          `https://api.jikan.moe/v4/top/manga?type=manga&limit=8`,
        );
        if (!response.ok) return;
        const data = await response.json();
        const top = (data.data || []).slice(0, 8).map((m) => ({
          id: m.mal_id,
          title: m.title_english || m.title,
          volumes: m.volumes || "—",
          // The render below treats `img` as a `{ avif, webp, jpg }`
          // bundle (the format the bundled mocked covers ship in). MAL
          // only serves JPG, so the avif/webp `<source>` slots stay
          // empty and `<picture>` naturally falls through to the
          // `<img src={img.jpg}>`. Returning a bare string here (the
          // previous behaviour) made `m.img.jpg` undefined and the
          // cards rendered as empty frames.
          img: { jpg: m.images?.jpg?.large_image_url },
        }));
        if (top.length) setTopMangas(top);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  return (
    <div className="relative isolate overflow-hidden grain min-h-[calc(100svh-4rem)]">
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
                className="group inline-flex items-center justify-center gap-2 rounded-full bg-hanko px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-washi shadow-xl glow-red transition hover:scale-[1.02] hover:bg-hanko-bright active:scale-95"
              >
                {isAuthed ? t("about.openDashboard") : t("about.getStarted")}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </a>
            </div>
          </div>

          {/* Hero image — collage of covers */}
          <div
            className="relative mx-auto mt-16 max-w-5xl animate-fade-up"
            style={{ animationDelay: "300ms" }}
          >
            <div className="relative">
              <div className="pointer-events-none absolute -inset-20 -z-10 opacity-40 blur-3xl">
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(ellipse at 30% 50%, oklch(0.6 0.22 25 / 0.3), transparent 60%), radial-gradient(ellipse at 70% 50%, oklch(0.82 0.13 78 / 0.15), transparent 60%)",
                  }}
                />
              </div>

              {/* Carousel of 8 covers */}
              <div className="grid grid-cols-4 gap-3 md:grid-cols-8">
                {topMangas.slice(0, 8).map((m, i) => (
                  <div
                    key={m.id}
                    className={`relative aspect-[2/3] overflow-hidden rounded-lg border border-border shadow-2xl transition-transform duration-500 hover:scale-105 hover:-translate-y-2 ${
                      i % 2 === 0 ? "md:translate-y-2" : "md:-translate-y-2"
                    }`}
                    style={{
                      animation: `fade-up 0.8s ${i * 80}ms both cubic-bezier(0.16, 1, 0.3, 1)`,
                    }}
                  >
                    {m.img && (
                      <picture>
                        <source srcSet={m.img.avif} type="image/avif" />
                        <source srcSet={m.img.webp} type="image/webp" />
                        <img
                          referrerPolicy="no-referrer"
                          src={m.img.jpg}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      </picture>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-ink-0 via-transparent to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-1.5">
                      <p className="line-clamp-1 font-display text-[10px] font-semibold text-washi drop-shadow">
                        {m.title}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Philosophy / Stats ─────────── */}
      <section className="relative px-4 py-16 sm:px-6 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-16">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
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
            <div className="space-y-5 text-base text-washi-muted md:text-lg">
              <p>{t("about.philosophyBody1")}</p>
              <p className="border-l-2 border-hanko/50 pl-4 font-display italic text-washi">
                "{t("about.philosophyQuote")}"
              </p>
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
            <FeatureCard
              number="01"
              title={t("about.f1Title")}
              description={t("about.f1Body")}
            />
            <FeatureCard
              number="02"
              title={t("about.f2Title")}
              description={t("about.f2Body")}
              accent
            />
            <FeatureCard
              number="03"
              title={t("about.f3Title")}
              description={t("about.f3Body")}
            />
            <FeatureCard
              number="04"
              title={t("about.f4Title")}
              description={t("about.f4Body")}
            />
            <FeatureCard
              number="05"
              title={t("about.f5Title")}
              description={t("about.f5Body")}
            />
            <FeatureCard
              number="06"
              title={t("about.f6Title")}
              description={t("about.f6Body")}
              accent
            />
          </div>
        </div>
      </section>

      {/* ─────────── Testimonials ─────────── */}
      <section className="relative px-4 py-16 sm:px-6 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("about.voicesLabel")}
            </span>
            <h2 className="mt-2 font-display text-3xl font-semibold italic text-washi md:text-4xl">
              {t("about.voicesHeading")}
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Testimonial
              quote={t("about.t1Quote")}
              name={t("about.t1Name")}
              role={t("about.t1Role")}
            />
            <Testimonial
              quote={t("about.t2Quote")}
              name={t("about.t2Name")}
              role={t("about.t2Role")}
            />
            <Testimonial
              quote={t("about.t3Quote", { provider: authName || "OAuth" })}
              name={t("about.t3Name")}
              role={t("about.t3Role")}
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
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-display italic font-light text-hanko/5 text-[20rem] leading-none select-none"
              aria-hidden="true"
            >
              始
            </span>
            <div className="relative">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
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
                  href="/log-in"
                  className="group inline-flex items-center gap-2 rounded-full bg-washi px-8 py-4 text-sm font-semibold uppercase tracking-wider text-ink-0 shadow-xl transition hover:scale-[1.02] active:scale-95"
                >
                  {t("about.startCollecting")}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
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
          <nav className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            <a className="hover:text-washi" href="/dashboard">
              Dashboard
            </a>
            <a className="hover:text-washi" href="/glossary">
              <span aria-hidden="true" className="font-jp text-xs">字典</span>
              <span className="ml-1.5">{t("about.footerGlossary")}</span>
            </a>
            <a className="hover:text-washi" href="/log-in">
              Sign in
            </a>
          </nav>
        </div>
      </footer>
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

function Testimonial({ quote, name, role }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 transition hover:-translate-y-0.5">
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-6 w-6 text-hanko/30"
      >
        <path d="M10 11H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v9c0 2.8-2.2 5-5 5v-2c1.7 0 3-1.3 3-3zM18 11h-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v9c0 2.8-2.2 5-5 5v-2c1.7 0 3-1.3 3-3z" />
      </svg>
      <p className="mt-3 font-display text-base italic leading-relaxed text-washi">
        {quote}
      </p>
      <div className="mt-4 flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-gold to-gold-muted font-display text-xs font-bold text-ink-0">
          {name[0]}
        </div>
        <div>
          <p className="font-display text-sm font-semibold text-washi">
            {name}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            {role}
          </p>
        </div>
      </div>
    </div>
  );
}
