import { useEffect, useRef, useState } from "react";
import { useOwnPublicSlug } from "@/hooks/usePublicProfile.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Settings section — toggle + editor for the user's public profile slug.
 *
 * UX:
 *   • Off by default (slug=null). Flipping the toggle reveals an input
 *     prefilled with a suggestion derived from the account name.
 *   • Saving validates server-side (3..32 chars, `[a-z0-9-]`, not
 *     reserved). 409 → "already taken" inline error.
 *   • When active, shows the full URL + a one-click copy button.
 */
export default function PublicProfileSection() {
  const t = useT();
  const {
    slug,
    showAdult,
    isLoading,
    update,
    isUpdating,
    updateError,
    updateShowAdult,
    isUpdatingAdult,
  } = useOwnPublicSlug();
  const [editing, setEditing] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const [localError, setLocalError] = useState(null);
  const inputRef = useRef(null);

  // Sync local state with fetched slug on first load / changes.
  useEffect(() => {
    if (slug) {
      setIsOpen(true);
      setEditing(slug);
    } else {
      setIsOpen(false);
      setEditing("");
    }
  }, [slug]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const fullUrl = slug ? `${origin}/u/${slug}` : null;

  const handleToggle = async () => {
    setLocalError(null);
    if (isOpen) {
      // Currently active → disable by clearing the slug.
      await update(null).catch(() => {});
      setIsOpen(false);
    } else {
      // Opening — reveal the input but don't commit until the user saves.
      setIsOpen(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleSave = async () => {
    setLocalError(null);
    const candidate = editing.trim().toLowerCase();
    if (!candidate) {
      await update(null).catch(() => {});
      setIsOpen(false);
      return;
    }
    try {
      await update(candidate);
    } catch (err) {
      const msg =
        err?.response?.data?.error ??
        (err?.response?.status === 409
          ? t("settings.publicProfileTaken")
          : t("settings.publicProfileInvalid"));
      setLocalError(msg);
    }
  };

  const handleCopy = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard?.writeText(fullUrl);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const dirty = editing.trim().toLowerCase() !== (slug ?? "");

  return (
    <section
      className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
      style={{ animationDelay: "250ms" }}
    >
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-moegi/20 text-moegi">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20" />
                <path d="M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
              </svg>
            </span>
            <h2 className="font-display text-lg font-semibold text-washi">
              {t("settings.publicProfileTitle")}
            </h2>
          </div>
          <p className="mt-1 text-xs text-washi-muted">
            {t("settings.publicProfileBody")}
          </p>
        </div>

        {/* Main toggle switch */}
        <button
          type="button"
          onClick={handleToggle}
          disabled={isLoading || isUpdating}
          aria-pressed={isOpen}
          aria-label={t("settings.publicProfileToggleAria")}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition disabled:opacity-40 ${
            isOpen
              ? "border-moegi bg-moegi/80"
              : "border-border bg-ink-2"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
              isOpen
                ? "left-[calc(100%_-_1.375rem)] bg-ink-0 shadow-md"
                : "left-0.5 bg-washi-dim"
            }`}
          />
        </button>
      </div>

      {/* Collapsible editor */}
      {isOpen && (
        <div className="space-y-3 rounded-xl border border-border bg-ink-0/40 p-4 animate-fade-up">
          <label
            htmlFor="public-slug-input"
            className="block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
          >
            {t("settings.publicProfileSlugLabel")}
          </label>
          <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
            <div className="flex flex-1 items-center overflow-hidden rounded-lg border border-border bg-ink-1 font-mono text-sm text-washi focus-within:border-hanko/50 focus-within:ring-2 focus-within:ring-hanko/20">
              <span className="pl-3 pr-1 text-washi-dim">/u/</span>
              <input
                id="public-slug-input"
                ref={inputRef}
                type="text"
                value={editing}
                onChange={(e) =>
                  setEditing(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && dirty && !isUpdating) handleSave();
                }}
                placeholder={t("settings.publicProfilePlaceholder")}
                maxLength={32}
                className="min-w-0 flex-1 bg-transparent py-2 pr-3 outline-none placeholder:text-washi-dim"
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || isUpdating}
              className="inline-flex items-center justify-center rounded-lg bg-hanko px-4 py-2 text-xs font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isUpdating ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
              ) : (
                t("common.save")
              )}
            </button>
          </div>

          {/* Live URL preview + copy button (only when there is an active, saved slug) */}
          {slug && !dirty && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-moegi/30 bg-moegi/5 p-3">
              <span className="font-mono text-[11px] text-washi-muted">
                {fullUrl}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-ink-2/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted transition hover:border-moegi/50 hover:text-washi"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
                {justCopied
                  ? t("settings.publicProfileCopied")
                  : t("settings.publicProfileCopy")}
              </button>
            </div>
          )}

          {/* Validation hint + errors */}
          <p className="font-mono text-[10px] text-washi-dim">
            {t("settings.publicProfileHint")}
          </p>
          {(localError || updateError) && (
            <p className="rounded-md border border-hanko/30 bg-hanko/10 px-3 py-2 text-xs text-hanko-bright">
              {localError ??
                updateError?.response?.data?.error ??
                t("settings.publicProfileInvalid")}
            </p>
          )}

          {/* Adult-content opt-in — secondary toggle, visible only when
              a slug is actively saved. Opt-in lives here (rather than as
              a visitor prompt) so the owner stays in control of what
              their gallery publishes; the visitor still has a second
              line of defence (banner + blur by default) on the public
              page itself. */}
          {slug && !dirty && (
            <div className="mt-2 flex items-center justify-between gap-4 rounded-lg border border-gold/30 bg-gold/5 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="grid h-5 w-5 place-items-center rounded-sm bg-gold/20 font-jp text-[11px] font-bold text-gold"
                  >
                    成
                  </span>
                  <p className="font-display text-sm font-semibold text-washi">
                    {t("settings.publicProfileAdultTitle")}
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-washi-muted">
                  {t("settings.publicProfileAdultBody")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateShowAdult(!showAdult).catch(() => {})}
                disabled={isUpdatingAdult}
                aria-pressed={showAdult}
                aria-label={t("settings.publicProfileAdultToggleAria")}
                className={`relative h-7 w-12 shrink-0 rounded-full border transition disabled:opacity-40 ${
                  showAdult
                    ? "border-gold bg-gold/80"
                    : "border-border bg-ink-2"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                    showAdult
                      ? "left-[calc(100%_-_1.375rem)] bg-ink-0 shadow-md"
                      : "left-0.5 bg-washi-dim"
                  }`}
                />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
