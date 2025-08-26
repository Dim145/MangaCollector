import Punpun from "../assets/punpun.jpg";
import Berserk from "../assets/berserk.jpg";
import Beastars from "../assets/beastars.jpg";
import TokyoGhoul from "../assets/tokyoghoul.webp";
import Vinland from "../assets/vinland.jpg";
import FirePunch from "../assets/firepunch.jpg";

export default function About() {
  const mockedManga = [
    {
      id: 1,
      title: "Fire Punch",
      volumes: 8,
      img: FirePunch,
    },
    {
      id: 2,
      title: "Goodnight Punpun",
      volumes: 13,
      img: Punpun,
    },
    {
      id: 3,
      title: "Tokyo Ghoul",
      volumes: 14,
      img: TokyoGhoul,
    },
    {
      id: 4,
      title: "Berserk",
      volumes: 41,
      img: Berserk,
    },
    {
      id: 5,
      title: "Vinland Saga",
      volumes: 27,
      img: Vinland,
    },
    {
      id: 6,
      title: "Beastars",
      volumes: 22,
      img: Beastars,
    },
  ];

  return (
    <div className="bg-gradient-to-b from-black via-gray-900 to-black min-h-screen text-white">
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* subtle glow */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.08),_transparent_60%)]" />
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="text-center space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
              Track every volume. Own your collection.
            </span>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight">
              Your Manga Collection,
              <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                {" "}
                Perfectly Organized
              </span>
            </h1>
            <p className="text-base md:text-lg text-gray-300/80 max-w-3xl mx-auto">
              Search series via the MyAnimeList API, add them to your library,
              and log each volume’s ownership, and price. Store them securely
              with Google OAuth 2.0.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <a
                href="/dashboard"
                className="rounded-2xl px-6 py-3 font-semibold bg-gradient-to-r from-gray-100 to-gray-300 text-black hover:scale-105 transition"
              >
                Open Dashboard
              </a>
              <a
                href="/log-in"
                className="rounded-2xl px-6 py-3 font-semibold border border-white/15 bg-white/5 text-white hover:bg-white/10 transition"
              >
                Sign up with Google
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Logos / Social proof */}
      <section className="max-w-6xl mx-auto px-6 py-8">
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-6">
          <p className="text-center text-xs tracking-wide text-gray-400 mb-4">
            Powered by
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 items-center">
            <LogoPill>MyAnimeList API</LogoPill>
            <LogoPill>PostgreSQL</LogoPill>
            <LogoPill>Express</LogoPill>
            <LogoPill>React + Tailwind</LogoPill>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16 md:py-24">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div className="space-y-4">
            <h2 className="text-3xl md:text-4xl font-bold">
              Everything you need to manage a growing shelf
            </h2>
            <p className="text-gray-300/80">
              MangaCollector streamlines collection tracking so you can spend
              more time reading.
            </p>
            <ul className="space-y-3">
              <FeatureItem title="Lightning-fast search">
                Query the MAL API for accurate titles, cover art, and volume
                counts.
              </FeatureItem>
              <FeatureItem title="Volume-level tracking">
                Toggle ownership, record prices, and note purchase locations.
              </FeatureItem>
              <FeatureItem title="Secure sessions">
                Google OAuth 2.0 with cookie-based sessions keeps access simple
                and safe.
              </FeatureItem>
            </ul>
          </div>
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6 md:p-8 shadow-2xl">
            <MockedDashboard mockedManga={mockedManga} />
          </div>
        </div>
      </section>

      {/* Metrics */}
      <section className="max-w-6xl mx-auto px-6 pb-12">
        <div className="grid gap-4">
          <StatCard value="65K+" label="Series added" />
        </div>
      </section>

      {/* Testimonials */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-3 gap-6">
          <Testimonial
            quote="I finally stopped losing track of which volumes I own."
            name="Kenji T."
            role="Collector of 300+ vols"
          />
          <Testimonial
            quote="Search is instant and accurate. Pulling from MAL makes it trustworthy."
            name="Aiko R."
            role="Seinen enthusiast"
          />
          <Testimonial
            quote="The Google login + sessions just work. No friction."
            name="Marco D."
            role="Full-stack dev & reader"
          />
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-white/10 to-white/5 p-8 md:p-12 text-center">
          <h3 className="text-2xl md:text-3xl font-bold mb-3">
            Start organizing your shelf today
          </h3>
          <p className="text-gray-300/80 mb-6">
            Sign in with Google, search your favorites, and start logging
            volumes in minutes.
          </p>
          <div className="flex justify-center gap-3">
            <a
              href="/log-in"
              className="rounded-2xl px-6 py-3 font-semibold bg-gradient-to-r from-gray-100 to-gray-300 text-black hover:scale-105 transition"
            >
              Get Started
            </a>
            {/* <a
              href="/dashboard"
              className="rounded-2xl px-6 py-3 font-semibold border border-white/15 bg-white/5 text-white hover:bg-white/10 transition"
            >
              View Demo
            </a> */}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-400">
            © {new Date().getFullYear()} MangaCollector. All rights reserved.
          </p>
          <nav className="flex items-center gap-5 text-sm text-gray-300">
            {/* <a className="hover:text-white" href="/privacy">
              Privacy
            </a>
            <a className="hover:text-white" href="/terms">
              Terms
            </a> */}
            <a className="hover:text-white" href="/dashboard">
              Dashboard
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ---------- Small subcomponents ---------- */

function LogoPill({ children }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200">
      {children}
    </div>
  );
}

function FeatureItem({ title, children }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3.5 w-3.5 text-emerald-400"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M16.707 5.293a1 1 0 0 1 0 1.414l-7.25 7.25a1 1 0 0 1-1.414 0L3.293 9.207a1 1 0 1 1 1.414-1.414l3.043 3.043 6.543-6.543a1 1 0 0 1 1.414 0z" />
        </svg>
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-gray-300/80">{children}</p>
      </div>
    </li>
  );
}

function StatCard({ value, label }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
      <div className="text-3xl font-extrabold">{value}</div>
      <div className="text-xs tracking-wide text-gray-400 mt-1">{label}</div>
    </div>
  );
}

function Testimonial({ quote, name, role }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <p className="text-gray-200">“{quote}”</p>
      <div className="mt-4 text-sm">
        <p className="font-semibold">{name}</p>
        <p className="text-gray-400">{role}</p>
      </div>
    </div>
  );
}

function MockedDashboard({ mockedManga }) {
  return (
    <div className="space-y-6 p-4 max-w-6xl mx-auto">
      {/* Header Skeleton */}
      <div className="h-fit w-fit rounded-2xl bg-gradient-to-r from-gray-800/80 to-gray-900/80 text-center mx-auto p-6 shadow-lg border border-gray-700 backdrop-blur-sm">
        <h2 className="text-2xl font-extrabold text-white mb-2 bg-clip-text bg-gradient-to-r from-white to-gray-400">
          Your Library
        </h2>
        <p className="text-gray-400 text-sm">
          Browse and manage all the manga in your collection
        </p>
      </div>

      {/* Manga Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {mockedManga.map((manga) => (
          <div
            key={manga.id}
            className="rounded-xl overflow-hidden border border-white/10 bg-white/5 shadow-lg hover:shadow-xl transition-shadow duration-300"
          >
            <div className="h-48 w-full bg-gray-700 overflow-hidden">
              <img
                src={manga.img}
                alt={manga.title}
                className="h-full w-full object-cover transform hover:scale-105 transition-transform duration-300"
              />
            </div>
            <div className="p-4 space-y-2 bg-gray-900 h-full">
              <h3 className="text-lg font-semibold text-white">
                {manga.title}
              </h3>
              <p className="text-sm text-gray-400">Volumes: {manga.volumes}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
