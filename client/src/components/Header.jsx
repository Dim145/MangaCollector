import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import ProfileButton from "./ProfileButton";
import { checkAuthStatus } from "../utils/auth";

const NAV_ITEMS = [
  {
    to: "/dashboard",
    label: "Library",
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
    label: "Add",
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
    to: "/profile",
    label: "Stats",
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
    to: "/settings",
    label: "Settings",
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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    (async () => {
      const user = await checkAuthStatus();
      setIsAuthenticated(Boolean(user));
    })();
  }, [location.pathname]);

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
        className={`sticky top-0 z-40 transition-all duration-300 ${
          scrolled
            ? "bg-ink-0/80 backdrop-blur-xl border-b border-border"
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
                        : "text-washi-muted hover:text-washi hover:bg-white/5"
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
            <ProfileButton />
          </div>
        </div>
      </header>

      {/* Mobile bottom nav */}
      {isAuthenticated && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
          aria-label="Main mobile"
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink-0 via-ink-0/80 to-transparent" />
          <div
            className="relative mx-3 mb-3 flex items-center justify-around gap-1 rounded-2xl border border-border bg-ink-1/90 p-1.5 backdrop-blur-xl shadow-2xl"
            style={{ paddingBottom: `calc(0.375rem + env(safe-area-inset-bottom))` }}
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-2 text-[10px] font-medium uppercase tracking-wider tap-none transition ${
                    isActive
                      ? "text-washi"
                      : "text-washi-dim active:bg-white/5"
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
