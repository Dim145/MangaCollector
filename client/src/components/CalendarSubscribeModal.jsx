import { useEffect, useState } from "react";
import Modal from "./ui/Modal.jsx";
import axios from "@/utils/axios.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 暦 · "Subscribe to your calendar" modal.
 *
 * The user lands here from the calendar page toolbar, sees the secret
 * URL of their personal ICS feed, and ships it to whatever subscriber
 * client they prefer (Apple Calendar, Google Calendar, Outlook).
 * Three actions:
 *
 *   - Copy URL — writes the canonical https URL to the clipboard.
 *   - Open in Apple Calendar — uses the `webcal://` scheme that
 *     Apple's "Subscribe to Calendar" handler claims natively. On
 *     desktop it pops the system dialog; on iOS it opens directly.
 *   - Open in Google Calendar — wraps the URL in Google's
 *     `?cid=…` add-by-URL flow. No special handler needed.
 *   - Regenerate — mints a new token, invalidating the previous URL.
 *     Confirmed in-flow because the action is destructive (every
 *     active subscriber stops receiving updates after their next
 *     refresh).
 *
 * The token itself never leaves the modal — it's part of the URL
 * but we don't render it as a separate selectable string. The user
 * only ever shares the full URL, which is the right primitive for
 * any calendar client.
 */
export default function CalendarSubscribeModal({ open, onClose }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copyState, setCopyState] = useState(null); // null | "ok" | "err"
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  // Lazy GET — only fires the first time the modal opens, and only
  // once per mount. The endpoint is idempotent (mints a token on
  // first call, returns it on every subsequent one) so re-fetching
  // on every reopen wouldn't be wrong, but it would waste a round-
  // trip; the result is stable until the user regenerates.
  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get("/api/user/calendar/ics-url");
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.error ?? err?.message ?? "Failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, data]);

  // Auto-fade the copy / regenerate toast so consecutive actions
  // don't pile up labels.
  useEffect(() => {
    if (!copyState) return;
    const timer = setTimeout(() => setCopyState(null), 2400);
    return () => clearTimeout(timer);
  }, [copyState]);

  const copyUrl = async () => {
    if (!data?.url) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setCopyState("ok");
    } catch {
      setCopyState("err");
    }
  };

  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await axios.post("/api/user/calendar/ics-url/regenerate");
      setData(res.data);
      setConfirmRegen(false);
      setCopyState("regen");
    } catch (err) {
      setError(err?.response?.data?.error ?? err?.message ?? "Failed");
    } finally {
      setRegenerating(false);
    }
  };

  const googleAddUrl = data?.url
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(data.url)}`
    : null;

  return (
    <Modal popupOpen={open} handleClose={onClose} additionalClasses="w-full max-w-xl">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-ink-1 via-ink-1/95 to-ink-0 p-6 backdrop-blur md:p-8">
        {/* 暦 watermark — same kanji language as the calendar page,
            tilted -2° so the modal feels stamped rather than printed. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-6 -right-2 select-none font-jp text-[12rem] font-bold leading-none text-moegi/[0.06]"
          style={{ transform: "rotate(-4deg)" }}
        >
          暦
        </span>

        <header className="relative">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-moegi">
            {t("calendarSubscribe.eyebrow")}
          </p>
          <h2
            data-autofocus
            tabIndex={-1}
            className="mt-2 font-display text-2xl font-light italic leading-tight text-washi md:text-3xl"
          >
            {t("calendarSubscribe.heading")}
          </h2>
          <p className="mt-2 max-w-md text-sm text-washi-muted">
            {t("calendarSubscribe.body")}
          </p>
        </header>

        {/* URL display + copy */}
        <div className="relative mt-6">
          <label
            htmlFor="ics-url-display"
            className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
          >
            {t("calendarSubscribe.urlLabel")}
          </label>
          <div className="flex flex-wrap items-stretch gap-2">
            <input
              id="ics-url-display"
              type="text"
              readOnly
              value={data?.url ?? ""}
              placeholder={
                error ? t("calendarSubscribe.errorLabel") : t("common.loading")
              }
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 rounded-lg border border-border bg-ink-2/40 px-3 py-2 font-mono text-[11px] text-washi placeholder:text-washi-dim focus:border-moegi/50 focus:outline-none focus:ring-2 focus:ring-moegi/20"
            />
            <button
              type="button"
              onClick={copyUrl}
              disabled={!data?.url}
              className="inline-flex items-center gap-1.5 rounded-lg border border-moegi/40 bg-moegi/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-moegi transition hover:border-moegi hover:bg-moegi/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
              {copyState === "ok"
                ? t("calendarSubscribe.copied")
                : copyState === "err"
                  ? t("calendarSubscribe.copyErr")
                  : t("common.copy") || "Copy"}
            </button>
          </div>
          {copyState === "regen" && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-moegi animate-fade-in">
              {t("calendarSubscribe.regenSuccess")}
            </p>
          )}
        </div>

        {/* Native subscriber-client deep links */}
        <div className="relative mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <a
            href={data?.webcal_url ?? "#"}
            aria-disabled={!data?.webcal_url}
            className={`group inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-ink-2/30 px-4 py-2.5 text-sm font-semibold text-washi-muted transition hover:border-washi/40 hover:bg-ink-2/50 hover:text-washi ${
              !data?.webcal_url
                ? "pointer-events-none opacity-50"
                : ""
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            <span>{t("calendarSubscribe.openApple")}</span>
          </a>
          <a
            href={googleAddUrl ?? "#"}
            target="_blank"
            rel="noreferrer noopener"
            aria-disabled={!googleAddUrl}
            className={`group inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-ink-2/30 px-4 py-2.5 text-sm font-semibold text-washi-muted transition hover:border-washi/40 hover:bg-ink-2/50 hover:text-washi ${
              !googleAddUrl ? "pointer-events-none opacity-50" : ""
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="8" y1="3" x2="8" y2="7" />
              <line x1="16" y1="3" x2="16" y2="7" />
              <path d="M12 14v3M10.5 15.5h3" />
            </svg>
            <span>{t("calendarSubscribe.openGoogle")}</span>
          </a>
        </div>

        {/* Privacy + regenerate strip */}
        <div className="relative mt-6 rounded-xl border border-hanko/25 bg-hanko/5 p-3.5">
          <p className="flex items-start gap-2 font-mono text-[11px] leading-snug text-washi-muted">
            <span
              aria-hidden
              className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-hanko/15 font-jp text-[10px] font-bold leading-none text-hanko"
              style={{ transform: "rotate(-4deg)" }}
            >
              機
            </span>
            <span>{t("calendarSubscribe.privacyWarn")}</span>
          </p>
          {!confirmRegen ? (
            <button
              type="button"
              onClick={() => setConfirmRegen(true)}
              disabled={!data}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-hanko/40 bg-transparent px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-hanko-bright transition hover:border-hanko hover:bg-hanko/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
                aria-hidden="true"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15A9 9 0 1 1 18 5.3L23 10" />
              </svg>
              {t("calendarSubscribe.regenerate")}
            </button>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating}
                className="inline-flex items-center gap-1.5 rounded-full bg-hanko px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-washi shadow-md transition hover:bg-hanko-bright disabled:opacity-60"
              >
                {regenerating
                  ? t("calendarSubscribe.regenRunning")
                  : t("calendarSubscribe.regenConfirm")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRegen(false)}
                disabled={regenerating}
                className="inline-flex items-center rounded-full border border-border bg-transparent px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-washi-muted transition hover:border-border/80 hover:text-washi disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="relative mt-4 rounded-lg border border-hanko/30 bg-hanko/5 px-3 py-2 text-xs text-hanko-bright">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
