import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import ProfileButton from "./ProfileButton";
import InstallPrompt from "./InstallPrompt";
import { useAuth } from "@/hooks/useAuth.js";
import { useT } from "@/i18n/index.jsx";

const NAV_ITEMS_BASE = [
  {
    to: "/dashboard",
    key: "library",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      </svg>
    ),
  },
  {
    to: "/addmanga",
    key: "add",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
    featured: true,
  },
  {
    // 帳 · The bottom-nav slot used to point at /profile back when
    // /profile was the analytics destination. Now /profile is a
    // proper identity page (reachable via the avatar in the
    // top-right) and the deep-dive ledger lives at /stats — the
    // chart icon below maps cleanly onto that destination.
    to: "/stats",
    key: "stats",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 4 4 5-5" />
      </svg>
    ),
  },
  {
    to: "/calendrier",
    key: "calendar",
    // Calendar icon — a stacked-block almanac, kept linear so it
    // visually rhymes with the seal/stats glyphs around it. The
    // 来 watermark on the page itself carries the kanji weight; the
    // nav icon stays neutral.
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <line x1="8" y1="3" x2="8" y2="7" />
        <line x1="16" y1="3" x2="16" y2="7" />
      </svg>
    ),
  },
  {
    to: "/settings",
    key: "settings",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const t = useT();
  // Shared auth state via TanStack Query — this is the same cache
  // entry consumed by ProtectedRoute and ProfileButton, so the three
  // components agree on "who the user is" without three independent
  // /auth/user calls per render. Previously the Header also
  // re-called `checkAuthStatus()` via `[location.pathname]` deps on
  // every navigation — an unnecessary round-trip for a value that
  // can't change between navigations.
  const { isAuthenticated } = useAuth();
  const NAV_ITEMS = NAV_ITEMS_BASE.map((item) => ({
    ...item,
    label: t(`nav.${item.key}`),
  }));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* Top header */}
      <header
        // 遷 · `view-transition-name` pins the header to its own
        // snapshot during route transitions. Without it, the header
        // was captured as part of the root snapshot — and because
        // the MangaPage hero cover (which carries its own
        // `view-transition-name`) gets hoisted out of that root
        // snapshot during the morph, the header's `backdrop-blur`
        // in the snapshot blurs a *different* background than it
        // does live (the cover position becomes transparent),
        // making the header appear to flicker / become extra
        // transparent for ~250ms. Giving the header its own name
        // captures it as a standalone snapshot with `backdrop-blur`
        // already baked in, so source ↔ dest cross-fade is
        // continuous.
        style={{ viewTransitionName: "app-header" }}
        // `backdrop-blur-md` instead of `xl` — the sticky header sits
        // over scrolling content so every scroll frame re-composites
        // the blur. 24px → 12px radius is ~4× cheaper and visually
        // indistinguishable at the density of content behind a header.
        className={`sticky top-0 z-40 transition-all duration-300 ${
          scrolled
            ? "bg-ink-0/85 backdrop-blur-md border-b border-border"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          {/* Brand */}
          <a
            href="/"
            className="group flex items-center gap-2.5 tap-none"
            aria-label="MangaCollector home"
          >
            <div className="relative">
              <span className="hanko-seal grid h-9 w-9 place-items-center rounded-md text-[10px] font-bold animate-stamp">
                MC
              </span>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[0.6rem] uppercase tracking-[0.25em] text-washi-dim">
                Archive
              </span>
              <span className="font-display text-lg font-semibold tracking-tight text-washi group-hover:text-hanko-bright transition-colors">
                Manga<span className="italic text-hanko">Collector</span>
              </span>
            </div>
          </a>

          {/* Desktop nav */}
          {isAuthenticated && (
            <nav
              className="hidden md:flex items-center gap-1 rounded-full border border-border bg-ink-1/50 p-1 backdrop-blur"
              aria-label="Main"
            >
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `relative flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                      isActive
                        ? "bg-hanko text-washi shadow-md glow-red"
                        : "text-washi-muted hover:text-washi hover:bg-washi/10"
                    }`
                  }
                >
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
          )}

          {/* Right cluster */}
          <div className="flex items-center gap-2">
            <InstallPrompt />
            <ProfileButton />
          </div>
        </div>
      </header>

      {/* Mobile bottom nav */}
      {isAuthenticated && (
        <nav
          // Same VT-pinning rationale as the top header above —
          // prevents the bottom nav's `backdrop-blur` from flickering
          // while route transitions are in flight on mobile.
          style={{ viewTransitionName: "app-bottom-nav" }}
          className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
          aria-label="Main mobile"
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink-0 via-ink-0/80 to-transparent" />
          <div
            // `backdrop-blur-md` instead of `xl` on the always-visible
            // mobile bottom nav — this is the highest-impact blur in
            // the app (it sits over scrolling content and on every
            // page). `shadow-2xl` already contributes a GPU cost so
            // we don't stack a heavy blur on top of it.
            className="relative mx-3 mb-3 flex items-center justify-around gap-1 rounded-2xl border border-border bg-ink-1/92 p-1.5 shadow-2xl"
            style={{
              paddingBottom: `calc(0.375rem + env(safe-area-inset-bottom))`,
            }}
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-2 text-[10px] font-medium uppercase tracking-wider tap-none transition ${
                    isActive
                      ? "text-washi"
                      : "text-washi-dim active:bg-washi/10"
                  } ${item.featured && "flex-none"}`
                }
                end
              >
                {({ isActive }) => (
                  <>
                    {item.featured ? (
                      <span
                        className={`grid h-12 w-12 place-items-center rounded-full transition-all ${
                          isActive
                            ? "bg-hanko text-washi glow-red -translate-y-3"
                            : "bg-hanko/90 text-washi -translate-y-2 shadow-lg"
                        }`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-5 w-5"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </span>
                    ) : (
                      <>
                        <span
                          className={`transition-transform ${
                            isActive && "scale-110"
                          }`}
                        >
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                        {isActive && (
                          <span className="absolute -top-0.5 left-1/2 h-1 w-6 -translate-x-1/2 rounded-full bg-hanko" />
                        )}
                      </>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </>
  );
}
