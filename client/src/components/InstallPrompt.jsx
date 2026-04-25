import { useEffect, useState } from "react";
import Modal from "./ui/Modal.jsx";
import { useT } from "@/i18n/index.jsx";

/**
 * PWA install affordance.
 *
 * Desktop + Android Chrome/Edge: listens for the `beforeinstallprompt` event
 * and surfaces a small install button in the header. Clicking fires the
 * native install dialog.
 *
 * iOS Safari: no `beforeinstallprompt` is ever fired — instead the user has
 * to tap Share → "Add to Home Screen". We detect iOS Safari and show the
 * shared <Modal> (portaled to body, locks scroll, full-page overlay) walking
 * them through it — same look and lifecycle as every other modal in the app.
 *
 * We hide the CTA once the app is already installed (standalone display mode)
 * or after the user dismisses it for the current session.
 */
const DISMISS_KEY = "mc:install-dismissed";

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

export default function InstallPrompt() {
  const t = useT();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosSheet, setShowIosSheet] = useState(false);
  // Read once at mount — nothing mutates this during the session
  // anymore (the explicit `dismiss` action was removed along with its
  // UI affordance). A plain value replaces the previous useState setup
  // so we don't carry an unused setter.
  const [dismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Android / Desktop — intercept the browser's native install event
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setShowIosSheet(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const closeSheet = () => setShowIosSheet(false);

  const handleClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch {
        /* user dismissed — fine */
      }
      setDeferredPrompt(null);
      return;
    }
    if (isIos()) setShowIosSheet(true);
  };

  const canInstall = Boolean(deferredPrompt) || isIos();
  const showButton = !dismissed && !isStandalone() && canInstall;

  return (
    <>
      {showButton && (
        <>
          {/* Desktop / large viewport — text + icon button */}
          <button
            type="button"
            onClick={handleClick}
            aria-label={t("install.cta")}
            className="group relative hidden sm:flex items-center gap-1.5 rounded-full border border-hanko/40 bg-hanko/10 px-3 py-1.5 text-xs font-semibold text-hanko-bright transition-all hover:border-hanko hover:bg-hanko/20 hover:scale-[1.03] active:scale-95"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            <span>{t("install.cta")}</span>
          </button>

          {/* Mobile — compact icon button */}
          <button
            type="button"
            onClick={handleClick}
            aria-label={t("install.cta")}
            className="grid sm:hidden h-9 w-9 place-items-center rounded-full border border-hanko/40 bg-hanko/10 text-hanko-bright transition active:scale-95"
          >
            <DownloadIcon className="h-4 w-4" />
          </button>
        </>
      )}

      <IosInstructions open={showIosSheet} onClose={closeSheet} />
    </>
  );
}

function DownloadIcon({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

/**
 * iOS Safari fallback. Wraps the shared <Modal> so the overlay portals into
 * <body> and behaves identically to AvatarPicker / MalRecommendationModal —
 * full-page backdrop, ESC + click-outside to close, scroll lock, top of the
 * stacking order regardless of where it's rendered from.
 */
function IosInstructions({ open, onClose }) {
  const t = useT();
  return (
    <Modal
      popupOpen={open}
      handleClose={onClose}
      additionalClasses="w-full max-w-sm"
    >
      {/* Inside Modal — no need for double backdrop-blur on the body. */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/98 shadow-2xl">
        {/* Atmospheric accents — same vocabulary as the other modals */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-hanko/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-gold/10 blur-3xl" />

        <header className="relative border-b border-border/60 px-5 pt-6 pb-4">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("install.iosLabel")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h2 className="mt-2 font-display text-xl font-light italic leading-none tracking-tight text-washi md:text-2xl">
            {t("install.iosTitle")}
          </h2>
        </header>

        <ol className="relative space-y-4 px-5 py-5 text-sm text-washi">
          <li className="flex gap-3">
            <Step n={1} />
            <span>
              {t("install.iosStep1Prefix")}{" "}
              <span className="inline-flex items-center gap-1 rounded-md bg-ink-2 px-1.5 py-0.5 text-[11px] font-mono text-washi">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <path d="M16 6l-4-4-4 4" />
                  <path d="M12 2v14" />
                </svg>
                {t("install.iosShareButton")}
              </span>
            </span>
          </li>
          <li className="flex gap-3">
            <Step n={2} />
            <span>{t("install.iosStep2")}</span>
          </li>
          <li className="flex gap-3">
            <Step n={3} />
            <span>{t("install.iosStep3")}</span>
          </li>
        </ol>

        <div className="relative flex justify-end border-t border-border/60 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-full bg-hanko px-4 py-1.5 text-sm font-semibold text-washi shadow-md transition hover:bg-hanko-bright active:scale-95"
          >
            {t("install.iosClose")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Step({ n }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-hanko/20 text-[11px] font-bold text-hanko-bright">
      {n}
    </span>
  );
}
