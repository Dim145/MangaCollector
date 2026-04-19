import { useContext, useEffect, useState } from "react";
import Punpun from "../assets/punpun.jpg";
import Berserk from "../assets/berserk.jpg";
import Beastars from "../assets/beastars.jpg";
import TokyoGhoul from "../assets/tokyoghoul.webp";
import Vinland from "../assets/vinland.jpg";
import FirePunch from "../assets/firepunch.jpg";
import SettingsContext from "@/SettingsContext.js";

const MOCKED = [
  { id: 1, title: "Fire Punch", volumes: 8, img: FirePunch },
  { id: 2, title: "Goodnight Punpun", volumes: 13, img: Punpun },
  { id: 3, title: "Tokyo Ghoul", volumes: 14, img: TokyoGhoul },
  { id: 4, title: "Berserk", volumes: 41, img: Berserk },
  { id: 5, title: "Vinland Saga", volumes: 27, img: Vinland },
  { id: 6, title: "Beastars", volumes: 22, img: Beastars },
];

export default function About() {
  const [topMangas, setTopMangas] = useState(MOCKED);
  const { authName } = useContext(SettingsContext);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(
          `https://api.jikan.moe/v4/top/manga?type=manga&limit=8`
        );
        if (!response.ok) return;
        const data = await response.json();
        const top = (data.data || []).slice(0, 8).map((m) => ({
          id: m.mal_id,
          title: m.title_english || m.title,
          volumes: m.volumes || "—",
          img: m.images?.jpg?.large_image_url,
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
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
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
              v1.0 · Archive your collection
            </span>

            <h1 className="mt-6 font-display text-5xl font-light leading-[0.95] tracking-tight text-washi md:text-7xl lg:text-8xl animate-fade-up">
              Every <em className="italic font-semibold text-hanko-gradient not-italic md:italic">volume</em>,
              <br />
              beautifully{" "}
              <span className="inline-block text-ink-gradient">archived.</span>
            </h1>

            <p
              className="mx-auto mt-6 max-w-xl text-base text-washi-muted md:text-lg animate-fade-up"
              style={{ animationDelay: "100ms" }}
            >
              MangaCollector is a quiet, devoted space to catalogue, track and
              cherish the series that shape you — volume by volume, shelf by
              shelf.
            </p>

            <div
              className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row animate-fade-up"
              style={{ animationDelay: "200ms" }}
            >
              <a
                href="/log-in"
                className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-hanko px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-washi shadow-xl glow-red transition hover:scale-[1.02] hover:bg-hanko-bright active:scale-95 sm:w-auto"
              >
                Get started
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
              <a
                href="/dashboard"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-ink-1/60 px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-washi-muted backdrop-blur transition hover:border-border/80 hover:text-washi sm:w-auto"
              >
                Open dashboard
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
                      <img
                        src={m.img}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
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
          <div className="grid gap-8 md:grid-cols-2 md:gap-16">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
                PHILOSOPHY · 想い
              </p>
              <h2 className="mt-3 font-display text-3xl font-light italic leading-tight text-washi md:text-5xl">
                A library worth
                <br />
                <span className="text-hanko-gradient font-semibold not-italic">
                  returning to.
                </span>
              </h2>
            </div>
            <div className="space-y-5 text-base text-washi-muted md:text-lg">
              <p>
                We believe collecting manga is an act of devotion. Each volume is
                a fragment of a world you've walked through — its weight, its
                spine, its smell of ink and paper, all of it matters.
              </p>
              <p className="border-l-2 border-hanko/50 pl-4 font-display italic text-washi">
                "Track what you own. Remember what you've paid. Celebrate what
                you've completed."
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
              FEATURES · 機能
            </span>
            <h2 className="mt-2 font-display text-3xl font-semibold italic text-washi md:text-4xl">
              Crafted for collectors.
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              number="01"
              title="Volume tracking"
              description="Toggle ownership, record prices, log store locations. Nothing slips through."
            />
            <FeatureCard
              number="02"
              title="MAL powered search"
              description="Instant metadata and cover art sourced from MyAnimeList. No manual entry unless you want it."
              accent
            />
            <FeatureCard
              number="03"
              title="Analytics"
              description="See completion rates, top-spent series, and how your collection grows over time."
            />
            <FeatureCard
              number="04"
              title="Custom entries"
              description="Doujinshi, rare prints, and obscure finds all welcomed. Add what MAL doesn't know."
            />
            <FeatureCard
              number="05"
              title="Adult filters"
              description="Fine-grained control over mature content — blur, hide, or show as you prefer."
            />
            <FeatureCard
              number="06"
              title="Secure sessions"
              description="OAuth 2.0 via your provider of choice. No passwords to manage, no data sold."
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
              VOICES · 声
            </span>
            <h2 className="mt-2 font-display text-3xl font-semibold italic text-washi md:text-4xl">
              From fellow readers.
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Testimonial
              quote="I finally stopped losing track of which volumes I own."
              name="Kenji T."
              role="Collector · 300+ volumes"
            />
            <Testimonial
              quote="Search is instant, metadata is accurate. Feels like my second shelf."
              name="Aiko R."
              role="Seinen enthusiast"
            />
            <Testimonial
              quote={`The ${authName || "OAuth"} login just works. No friction at all.`}
              name="Marco D."
              role="Full-stack dev & reader"
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
                BEGIN
              </p>
              <h2 className="mt-3 font-display text-3xl font-light italic leading-tight text-washi md:text-5xl">
                Your archive <span className="font-semibold not-italic text-hanko-gradient">awaits.</span>
              </h2>
              <p className="mx-auto mt-4 max-w-md text-sm text-washi-muted md:text-base">
                Sign in, search a title, and start the quiet joy of cataloguing.
              </p>
              <div className="mt-8">
                <a
                  href="/log-in"
                  className="group inline-flex items-center gap-2 rounded-full bg-washi px-8 py-4 text-sm font-semibold uppercase tracking-wider text-ink-0 shadow-xl transition hover:scale-[1.02] active:scale-95"
                >
                  Start collecting
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
              © {new Date().getFullYear()} MangaCollector
            </p>
          </div>
          <nav className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            <a className="hover:text-washi" href="/dashboard">
              Dashboard
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
          <p className="font-display text-sm font-semibold text-washi">{name}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            {role}
          </p>
        </div>
      </div>
    </div>
  );
}
