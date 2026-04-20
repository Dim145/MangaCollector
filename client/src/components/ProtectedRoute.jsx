import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuthStatus, getCachedUser } from "../utils/auth";
import DefaultBackground from "./DefaultBackground";
import { useT } from "@/i18n/index.jsx";

/*
 * Render protected children as long as we have ANY reason to believe the
 * user is logged in:
 *   - cached profile present (survives server outages)  → render immediately
 *   - background `/auth/user` comes back 200            → refresh cache
 *   - background `/auth/user` comes back 401/403        → redirect to login
 *   - background `/auth/user` fails (network / 5xx)     → keep rendering
 *                                                          (don't punish the
 *                                                          user for backend
 *                                                          downtime)
 */
export default function ProtectedRoute({ children, setGoogleUser }) {
  const t = useT();
  const [status, setStatus] = useState(() => {
    const cached = getCachedUser();
    return cached ? { kind: "cached", user: cached } : { kind: "checking" };
  });
  const navigate = useNavigate();

  useEffect(() => {
    if (status.kind === "cached" && status.user) {
      setGoogleUser(status.user);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getAuthStatus();
      if (cancelled) return;

      if (result.kind === "authenticated") {
        setStatus(result);
        setGoogleUser(result.user);
        return;
      }

      if (result.kind === "unauthenticated") {
        setStatus(result);
        navigate("/log-in");
        return;
      }

      if (result.kind === "cached") {
        setStatus(result);
        setGoogleUser(result.user);
        return;
      }

      // "unknown" — server unreachable AND no cached profile. First-ever
      // visit during an outage. Keep the user parked rather than login.
      setStatus(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, setGoogleUser]);

  if (status.kind === "checking") {
    return (
      <DefaultBackground>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-hanko/30" />
            <span className="hanko-seal relative grid h-14 w-14 place-items-center rounded-lg font-display text-base font-bold">
              MC
            </span>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim animate-pulse">
            {t("auth.loadingArchive")}
          </p>
        </div>
      </DefaultBackground>
    );
  }

  if (status.kind === "unknown") {
    // First load during server outage with no cache — can't prove auth,
    // can't use cache, but pushing to /log-in won't help either (login
    // itself needs the server). Show a dedicated screen instead.
    return (
      <DefaultBackground>
        <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
          <span className="hanko-seal grid h-14 w-14 place-items-center rounded-lg font-display text-base font-bold animate-pulse-glow">
            待
          </span>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
            {t("auth.serverUnreachableLabel")}
          </p>
          <h1 className="font-display text-2xl font-light italic text-washi md:text-3xl">
            {t("auth.verifyingSession")}
          </h1>
          <p className="text-sm text-washi-muted">{t("auth.verifyingBody")}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 rounded-full border border-border bg-ink-1/60 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/40 hover:text-washi"
          >
            {t("common.retryNow")}
          </button>
        </div>
      </DefaultBackground>
    );
  }

  if (status.kind === "unauthenticated") {
    return null; // navigating to /log-in
  }

  // 'authenticated' or 'cached' — render children
  return children;
}
