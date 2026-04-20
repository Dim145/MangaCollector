import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import SettingsContext from "@/SettingsContext.js";
import { checkAuthStatus, initiateOAuth } from "../utils/auth";
import { useT } from "@/i18n/index.jsx";

export default function Login() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { authName, authIcon } = useContext(SettingsContext);
  const t = useT();

  useEffect(() => {
    (async () => {
      const user = await checkAuthStatus();
      if (user) navigate("/dashboard");
    })();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("error") === "auth_failed") {
      setError(t("login.authFailed"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const handleLogin = () => {
    setIsLoading(true);
    setError("");
    initiateOAuth();
  };

  const providerLabel = authName || t("login.providerFallback");
  const isGoogle = String(authName || "").toLowerCase() === "google";

  return (
    <div className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden grain flex items-center justify-center px-4 py-12">
      {/* Atmospheric background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -top-1/3 left-1/2 h-[60rem] w-[60rem] -translate-x-1/2 rounded-full opacity-50 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.6 0.22 25 / 0.25), transparent 60%)",
          }}
        />
        <div
          className="absolute bottom-0 left-0 h-[30rem] w-[30rem] rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.82 0.13 78 / 0.2), transparent 70%)",
          }}
        />
      </div>

      {/* Japanese character ornament */}
      <span
        className="pointer-events-none absolute right-[-10%] top-[10%] font-display italic font-light text-hanko/5 text-[30rem] leading-none select-none hidden md:block"
        aria-hidden="true"
      >
        巻
      </span>
      <span
        className="pointer-events-none absolute left-[-5%] bottom-[-5%] font-display italic font-light text-gold/5 text-[20rem] leading-none select-none hidden md:block"
        aria-hidden="true"
      >
        読
      </span>

      <div className="relative w-full max-w-md animate-fade-up">
        {/* Hanko branding */}
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="hanko-seal mb-5 grid h-20 w-20 place-items-center rounded-lg font-display text-2xl font-bold glow-red animate-stamp">
            MC
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
            {t("login.brandLabel")}
          </span>
          <h1 className="mt-3 font-display text-4xl font-light italic tracking-tight text-washi md:text-5xl">
            {t("login.welcomeBack")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("login.back")}
            </span>
          </h1>
          <p className="mt-3 max-w-xs text-sm text-washi-muted">
            {t("login.byline")}
          </p>
        </div>

        {/* Card */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/70 p-6 shadow-2xl backdrop-blur-2xl md:p-8">
          {/* Top ornamental line */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, oklch(0.6 0.22 25 / 0.6), transparent)",
            }}
          />

          {error && (
            <div className="mb-5 flex items-start gap-2 rounded-lg border border-hanko/30 bg-hanko/10 p-3 text-xs text-hanko-bright animate-fade-up">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 shrink-0 mt-0.5"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-washi px-6 py-4 font-semibold text-ink-0 shadow-lg transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-hanko/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
            {isLoading ? (
              <span className="relative h-5 w-5 animate-spin rounded-full border-2 border-ink-0/30 border-t-ink-0" />
            ) : isGoogle ? (
              <svg className="relative h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            ) : (
              authIcon && (
                <img src={authIcon} alt="" className="relative h-5 w-5" />
              )
            )}
            <span className="relative">
              {isLoading
                ? t("login.redirecting")
                : t("login.continueWith", { provider: providerLabel })}
            </span>
          </button>

          <div className="mt-6 divider-ornament font-mono text-[10px] uppercase tracking-[0.2em]">
            <span>{t("login.whatYouGet")}</span>
          </div>

          {/* Features */}
          <ul className="mt-4 space-y-3">
            <Feature>{t("login.benefit1")}</Feature>
            <Feature>{t("login.benefit2")}</Feature>
            <Feature>{t("login.benefit3")}</Feature>
          </ul>
        </div>

        <p className="mt-6 text-center text-[10px] uppercase tracking-wider text-washi-dim">
          {t("login.terms", {
            terms: t("login.termsLabel"),
            privacy: t("login.privacyLabel"),
          })}
        </p>
      </div>
    </div>
  );
}

function Feature({ children }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-washi-muted">
      <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-hanko/20 text-hanko-bright">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-2.5 w-2.5"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      {children}
    </li>
  );
}
