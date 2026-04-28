import { useMemo, useState } from "react";
import Modal from "./ui/Modal.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { useSessions } from "@/hooks/useSessions.js";
import { logout } from "@/utils/auth.js";
import { notifySyncError } from "@/lib/sync.js";
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

  // 直 · Defensive de-duplication of `is_current`. The server is
  // expected to mark exactly one session as the caller's own; if a bug
  // ever flags multiple, only the most-recently-active one keeps the
  // pill — otherwise the "this device" cue loses meaning. Memoised so
  // the dedupe pass doesn't run on every render of an unrelated modal
  // state change (pendingId, error…).
  const dedupedSessions = useMemo(() => {
    if (!Array.isArray(sessions) || sessions.length === 0) return sessions;
    const currentIdx = (() => {
      let bestIdx = -1;
      let bestTs = -Infinity;
      sessions.forEach((s, idx) => {
        if (!s.is_current) return;
        const ts = s.last_seen_at
          ? new Date(s.last_seen_at).getTime()
          : 0;
        if (ts > bestTs) {
          bestTs = ts;
          bestIdx = idx;
        }
      });
      return bestIdx;
    })();
    if (currentIdx < 0) return sessions;
    return sessions.map((s, idx) =>
      s.is_current && idx !== currentIdx ? { ...s, is_current: false } : s,
    );
  }, [sessions]);

  const handleRevoke = async (session) => {
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
      notifySyncError(err, "session-revoke");
    } finally {
      setPendingId(null);
    }
  };

  // 静 · Global revocation lock. The original code only disabled the
  // *currently-revoking* session's button, but rendering happens AFTER
  // setPendingId resolves — so two rapid clicks on different rows could
  // both fire DELETEs before the disabled state propagated. Computing
  // a global lock on every row's `disabled` prop closes that window
  // (any pending revoke OR any in-flight mutation locks every button).
  const revokeLocked = pendingId !== null || isRevoking;

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

          {dedupedSessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              onRevoke={() => handleRevoke(s)}
              // Show "Revoking…" only on the row whose DELETE is in
              // flight; lock every other row to defuse double-clicks.
              pending={pendingId === s.id}
              locked={revokeLocked && pendingId !== s.id}
              t={t}
            />
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function SessionRow({ session, onRevoke, pending, locked = false, t }) {
  const ua = session.user_agent ?? "";
  const label = session.device_label || t("sessions.unknownDevice");
  // Memoise the relative+absolute dates so an unrelated parent re-
  // render (the audit flagged formatRelative recalculating on every
  // poll tick) doesn't re-run them. Cheap, but the modal can have
  // 5-10 rows and this fires on every minute-tick of the polling
  // loop in larger fleets.
  const lastSeen = useMemo(
    () => formatRelative(session.last_seen_at, t),
    [session.last_seen_at, t],
  );
  const created = useMemo(
    () => formatAbsolute(session.created_at),
    [session.created_at],
  );

  // Mobile (< sm): stacked layout — icon + content on one row, the
  // revoke button anchored full-width below. The date line is allowed
  // to wrap to two lines (no `truncate`) because the row has the
  // breathing space and a clipped "Actif à l'ins…" is unhelpful.
  //
  // Desktop (≥ sm): single row — icon, content, button side-by-side.
  // The date line uses `truncate` because the button steals horizontal
  // real estate and we'd otherwise overflow the modal width.
  return (
    <li
      className={`group relative overflow-hidden rounded-xl border p-3 transition sm:py-3 sm:px-4 ${
        session.is_current
          ? "border-hanko/40 bg-hanko/5"
          : "border-border bg-ink-2/40"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <DeviceIcon label={session.device_label} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="font-display text-base font-semibold leading-tight text-washi">
                {label}
              </p>
              {session.is_current && (
                <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-hanko/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-hanko-bright">
                  {t("sessions.thisDevice")}
                </span>
              )}
            </div>
            <p
              className="mt-1 font-mono text-[10px] leading-relaxed text-washi-dim sm:mt-0.5 sm:truncate sm:leading-normal"
              title={ua}
            >
              {lastSeen} · {t("sessions.signedIn", { date: created })}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRevoke}
          // `pending` = this row's DELETE is in flight (shows "Revoking…").
          // `locked` = a *different* row's DELETE is in flight; we
          // disable this button to prevent racing concurrent reqs.
          disabled={pending || locked}
          aria-label={
            session.is_current
              ? t("sessions.revokeCurrent")
              : t("sessions.revoke")
          }
          className={`w-full shrink-0 rounded-full border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50 sm:w-auto sm:py-1.5 ${
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
