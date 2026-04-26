import { useState } from "react";
import Modal from "./ui/Modal.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { useSessions } from "@/hooks/useSessions.js";
import { logout } from "@/utils/auth.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 機 · "Your devices" modal.
 *
 * One row per active session, sorted by last activity. The user's
 * current device is pinned with a hanko-coloured "this device" pill
 * and styled distinct so revoking it is a deliberate choice — clicking
 * its revoke button performs a full logout (server-side delete of the
 * session, client-side redirect to /log-in).
 *
 * Lazy-loaded from ProfileButton so the chunk only ships when the
 * user actually opens the menu and clicks "Active sessions".
 */
export default function SessionsModal({ open, onClose }) {
  const t = useT();
  const { sessions, isLoading, isError, refetch, revoke, isRevoking } =
    useSessions();
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState(null);

  const handleRevoke = async (session) => {
    setError(null);
    setPendingId(session.id);
    try {
      await revoke(session.id);
      if (session.is_current) {
        // Revoking your own session = explicit logout. Hand off to
        // the regular logout helper so the auth cache is cleared
        // and the redirect happens.
        await logout().catch(() => {});
        window.location.href = "/log-in";
      }
    } catch (err) {
      setError(err?.response?.data?.error ?? err?.message ?? "Failed");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Modal popupOpen={open} handleClose={onClose} additionalClasses="w-full max-w-xl">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-ink-1 via-ink-1/95 to-ink-0 p-6 backdrop-blur md:p-8">
        {/* Watermark — 機 (ki, "device / mechanism") in the corner so
            the modal carries the same kanji-supertitle voice as the
            rest of the app. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-6 -right-2 select-none font-display italic font-light leading-none text-hanko/5"
          style={{ fontSize: "12rem" }}
        >
          機
        </span>

        <header className="relative">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
            {t("sessions.kicker")} · 機
          </p>
          <h2
            data-autofocus
            tabIndex={-1}
            className="mt-2 font-display text-2xl font-light italic leading-tight text-washi md:text-3xl"
          >
            {t("sessions.heading")}
          </h2>
          <p className="mt-2 max-w-md text-sm text-washi-muted">
            {t("sessions.body")}
          </p>
        </header>

        <ul role="list" className="relative mt-6 space-y-2">
          {isLoading && (
            <>
              {[...Array(3)].map((_, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-xl border border-border bg-ink-2/40 px-4 py-3"
                >
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-2.5 w-2/3" />
                  </div>
                </li>
              ))}
            </>
          )}

          {isError && !isLoading && (
            <li className="rounded-xl border border-hanko/30 bg-hanko/5 px-4 py-3 text-sm text-hanko-bright">
              {t("sessions.fetchError")}{" "}
              <button
                type="button"
                onClick={() => refetch()}
                className="ml-2 underline hover:no-underline"
              >
                {t("common.retry")}
              </button>
            </li>
          )}

          {!isLoading && !isError && sessions.length === 0 && (
            <li className="rounded-xl border border-border bg-ink-2/40 px-4 py-6 text-center text-sm italic text-washi-muted">
              {t("sessions.empty")}
            </li>
          )}

          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              onRevoke={() => handleRevoke(s)}
              pending={pendingId === s.id || isRevoking}
              t={t}
            />
          ))}
        </ul>

        {error && (
          <p className="relative mt-4 rounded-lg border border-hanko/30 bg-hanko/5 px-3 py-2 text-xs text-hanko-bright">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function SessionRow({ session, onRevoke, pending, t }) {
  const ua = session.user_agent ?? "";
  const label = session.device_label || t("sessions.unknownDevice");
  const lastSeen = formatRelative(session.last_seen_at, t);
  const created = formatAbsolute(session.created_at);

  return (
    <li
      className={`group relative overflow-hidden rounded-xl border px-4 py-3 transition ${
        session.is_current
          ? "border-hanko/40 bg-hanko/5"
          : "border-border bg-ink-2/40"
      }`}
    >
      <div className="flex items-center gap-3">
        <DeviceIcon label={session.device_label} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="font-display text-base font-semibold text-washi">
              {label}
            </p>
            {session.is_current && (
              <span className="inline-flex items-center gap-1 rounded-full bg-hanko/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.25em] text-hanko-bright">
                {t("sessions.thisDevice")}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-washi-dim" title={ua}>
            {lastSeen} · {t("sessions.signedIn", { date: created })}
          </p>
        </div>
        <button
          type="button"
          onClick={onRevoke}
          disabled={pending}
          aria-label={
            session.is_current
              ? t("sessions.revokeCurrent")
              : t("sessions.revoke")
          }
          className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50 ${
            session.is_current
              ? "border-hanko/50 text-hanko-bright hover:border-hanko hover:bg-hanko/10"
              : "border-border text-washi-muted hover:border-hanko/40 hover:text-washi"
          }`}
        >
          {pending
            ? t("sessions.revoking")
            : session.is_current
              ? t("sessions.signOut")
              : t("sessions.revoke")}
        </button>
      </div>
    </li>
  );
}

/**
 * Pictogram per platform — same vocabulary as the device labels.
 * Falls back to a generic monitor glyph when the UA isn't recognised.
 */
function DeviceIcon({ label }) {
  const path = (() => {
    if (label === "iPhone" || label === "Android") {
      return "M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4Zm6 16h2";
    }
    if (label === "iPad") {
      return "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm7 14h2";
    }
    return null;
  })();
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-ink-1/60 text-washi-muted">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        {path ? (
          <path d={path} />
        ) : (
          <>
            <rect x="2" y="4" width="20" height="14" rx="2" />
            <path d="M8 22h8M12 18v4" />
          </>
        )}
      </svg>
    </span>
  );
}

function formatRelative(iso, t) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return t("sessions.lastSeenJustNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("sessions.lastSeenMinutes", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("sessions.lastSeenHours", { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 30) return t("sessions.lastSeenDays", { n: day });
  return t("sessions.lastSeenLongAgo");
}

function formatAbsolute(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
