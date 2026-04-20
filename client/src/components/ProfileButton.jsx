import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { checkAuthStatus, logout } from "../utils/auth";
import { useT } from "@/i18n/index.jsx";
import { useUserSettings } from "@/hooks/useSettings.js";

export default function ProfileButton() {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [user, setUser] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const t = useT();
  const { data: settings } = useUserSettings();
  const avatarUrl = !avatarFailed ? (settings?.avatarUrl ?? null) : null;

  useEffect(() => {
    const verifyAuth = async () => {
      const user = await checkAuthStatus();
      if (user) {
        setIsAuthenticated(true);
        setUser(user);
      } else {
        setIsAuthenticated(false);
      }
    };
    verifyAuth();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e) => e.key === "Escape" && setIsOpen(false);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keyup", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keyup", handleEsc);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      setIsAuthenticated(false);
      setUser(null);
      navigate("/log-in");
    } catch (error) {
      console.error("Logout failed: ", error);
    }
  };

  const initial = user?.name?.[0]?.toUpperCase() ?? "U";

  if (isAuthenticated === null) {
    return <div className="h-9 w-9 rounded-full animate-shimmer" />;
  }

  if (!isAuthenticated) {
    return (
      <button
        onClick={() => navigate("/log-in")}
        className="rounded-full bg-hanko px-4 py-1.5 text-sm font-semibold text-washi shadow-md transition-transform hover:scale-[1.03] active:scale-95 glow-red"
      >
        {t("nav.signIn")}
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Open account menu"
        className={`group relative grid h-9 w-9 place-items-center overflow-hidden rounded-full font-display text-sm font-bold text-ink-0 transition-transform hover:scale-105 active:scale-95 ring-2 ring-transparent focus-visible:ring-hanko ${
          avatarUrl
            ? "bg-ink-2 hover:ring-hanko/60"
            : "bg-gradient-to-br from-gold to-gold-muted hover:ring-gold/50"
        }`}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <>
            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-gold/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity blur-md" />
            <span className="relative">{initial}</span>
          </>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-3 w-56 origin-top-right overflow-hidden rounded-xl border border-border bg-ink-2/95 shadow-2xl backdrop-blur-xl animate-slide-down"
        >
          <div className="flex items-center gap-3 border-b border-border p-3">
            <div
              className={`grid h-10 w-10 place-items-center overflow-hidden rounded-full font-display text-base font-bold text-ink-0 ${
                avatarUrl
                  ? "bg-ink-2"
                  : "bg-gradient-to-br from-gold to-gold-muted"
              }`}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                initial
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-washi">
                {user?.name ?? "Reader"}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-washi-dim">
                {t("nav.collector")}
              </p>
            </div>
          </div>

          <ul className="flex flex-col py-1.5" role="none">
            <MenuItem
              onClick={() => {
                setIsOpen(false);
                navigate("/dashboard");
              }}
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
                </svg>
              }
              label={t("nav.library")}
            />
            <MenuItem
              onClick={() => {
                setIsOpen(false);
                navigate("/profile");
              }}
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M3 3v18h18" />
                  <path d="M7 14l4-4 4 4 5-5" />
                </svg>
              }
              label={t("nav.statistics")}
            />
            <MenuItem
              onClick={() => {
                setIsOpen(false);
                navigate("/settings");
              }}
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              }
              label={t("nav.settings")}
            />
            <div className="my-1 h-px bg-border" />
            <MenuItem
              onClick={handleLogout}
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              }
              label={t("nav.signOut")}
              danger
            />
          </ul>
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, icon, label, danger }) {
  return (
    <li role="none">
      <button
        role="menuitem"
        onClick={onClick}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
          danger
            ? "text-hanko-bright hover:bg-hanko/10"
            : "text-washi hover:bg-washi/10"
        }`}
      >
        <span className={danger ? "text-hanko-bright" : "text-washi-muted"}>
          {icon}
        </span>
        {label}
      </button>
    </li>
  );
}
