import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { logout } from "../utils/auth";
import { useAuth } from "@/hooks/useAuth.js";
import { useOnline } from "@/hooks/useOnline.js";
import { useT } from "@/i18n/index.jsx";
import { useUserSettings } from "@/hooks/useSettings.js";
import { queryClient } from "@/lib/queryClient.js";

// 機 · Active-sessions modal — only mounted when the user opens it.
// Heavy enough (table renderer + UA-based icons) that lazy-loading
// keeps it off every page that includes the header.
const SessionsModal = lazy(() => import("./SessionsModal.jsx"));

export default function ProfileButton() {
  // Shared auth state — same cache entry as Header/ProtectedRoute.
  // On logout we invalidate the key so the next render everywhere
  // re-reads from the server.
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const online = useOnline();
  const [isOpen, setIsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const t = useT();
  const { data: settings } = useUserSettings();
  const savedAvatar = settings?.avatarUrl ?? null;

  // Avatar-failure self-healing.
  //
  // `avatarFailed` used to be a one-way latch: an `<img onError>` fire
  // (transient CDN hiccup, slow cold start, MAL 429, SW caching a bad
  // response) would set it true forever because ProfileButton lives
  // inside Header and Header mounts once per session — no remount,
  // no reset. The initials fallback would stick until the user did a
  // full page reload, producing the "mon avatar disparaît parfois"
  // bug.
  //
  // Two recovery paths now:
  //   1. URL change  — picking a different character in AvatarPicker
  //      bumps `savedAvatar`; we reset so the new image gets a real
  //      load attempt.
  //   2. Same-URL retry — even with an unchanged URL, we give the
  //      browser a fresh attempt 30s after a failure. Covers the
  //      transient-network case where the URL is valid but the
  //      first load raced a hiccup. Harmless if still failing — the
  //      `<img>` just re-invokes onError and we wait another 30s.
  useEffect(() => {
    // Any URL change (including swap to a new character, or logout
    // → login as another user whose settings arrive in Dexie) gets
    // a fresh shot.
    setAvatarFailed(false);
  }, [savedAvatar]);

  useEffect(() => {
    if (!avatarFailed) return;
    const id = setTimeout(() => setAvatarFailed(false), 30_000);
    return () => clearTimeout(id);
  }, [avatarFailed]);

  const avatarUrl = !avatarFailed ? savedAvatar : null;

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
      // Invalidate the shared auth query so every consumer
      // (Header, ProtectedRoute) re-reads and observes the logout.
      queryClient.setQueryData(["auth", "user"], null);
      navigate("/log-in");
    } catch (error) {
      console.error("Logout failed: ", error);
    }
  };

  const initial = user?.name?.[0]?.toUpperCase() ?? "U";

  if (authLoading) {
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
          <img referrerPolicy="no-referrer"
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
          // Dropdown sits over raw page content, so it DOES need its
          // own blur. `md` (12px) is plenty frosted for a small
          // surface; `xl` (24px) was a GPU tax with no visual win at
          // this scale. Opacity bumped /95 → /96 to compensate.
          className="absolute right-0 mt-3 w-56 origin-top-right overflow-hidden rounded-xl border border-border bg-ink-2/96 shadow-2xl backdrop-blur-md animate-slide-down"
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
                <img referrerPolicy="no-referrer"
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
            {/* 機 · Active sessions — opens the device-list modal. We
                keep this OUT of /settings (already crowded) and put
                it in the profile menu where session-related actions
                naturally live alongside sign-out.
                Disabled offline: the list and any revoke action both
                require the server, so the entry is dimmed with a
                "needs connection" hint rather than hidden — the user
                still sees the affordance and knows it's coming back. */}
            <MenuItem
              onClick={
                online
                  ? () => {
                      setIsOpen(false);
                      setSessionsOpen(true);
                    }
                  : undefined
              }
              disabled={!online}
              hint={!online ? t("sessions.offlineHint") : undefined}
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
                  <rect x="2" y="4" width="20" height="14" rx="2" />
                  <path d="M8 22h8M12 18v4" />
                </svg>
              }
              label={t("nav.sessions")}
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

      {/* Sessions modal — lazy-mounted only when the user actually
          opens it; closed state keeps the chunk off the wire. */}
      {sessionsOpen && (
        <Suspense fallback={null}>
          <SessionsModal
            open
            onClose={() => setSessionsOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

function MenuItem({ onClick, icon, label, danger, disabled, hint }) {
  return (
    <li role="none">
      <button
        role="menuitem"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        title={hint}
        aria-disabled={disabled || undefined}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
          disabled
            ? "cursor-not-allowed text-washi-dim"
            : danger
              ? "text-hanko-bright hover:bg-hanko/10"
              : "text-washi hover:bg-washi/10"
        }`}
      >
        <span
          className={
            disabled
              ? "text-washi-dim/60"
              : danger
                ? "text-hanko-bright"
                : "text-washi-muted"
          }
        >
          {icon}
        </span>
        <span className="flex-1">{label}</span>
        {disabled && hint && (
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-washi-dim/70">
            {hint}
          </span>
        )}
      </button>
    </li>
  );
}
