import { useMemo, useState } from "react";
import Modal from "./ui/Modal.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { useAvatarChoices } from "@/hooks/useAvatarChoices.js";
import { useUpdateSettings, useUserSettings } from "@/hooks/useSettings.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Avatar picker. Shows a grid of character portraits grouped by series,
 * sourced from Jikan via `useAvatarChoices`. Selecting one persists to the
 * settings table — removing goes back to the initial-letter fallback.
 */
export default function AvatarPicker({ open, onClose }) {
  const t = useT();
  const { groups, isLoading, isFetching, hasSources, error } = useAvatarChoices(
    { sourceLimit: 10 },
  );
  const { data: settings } = useUserSettings();
  const updateSettings = useUpdateSettings();
  const [mainOnly, setMainOnly] = useState(false);
  const currentAvatar = settings?.avatarUrl ?? null;

  const filteredGroups = useMemo(() => {
    if (!mainOnly) return groups;
    return groups
      .map((g) => ({
        ...g,
        characters: g.characters.filter((c) => c.role === "Main"),
      }))
      .filter((g) => g.characters.length > 0);
  }, [groups, mainOnly]);

  const handleSelect = (imageUrl) => {
    const next = { ...(settings ?? {}), avatarUrl: imageUrl };
    updateSettings.mutate(next);
    onClose?.();
  };

  const handleRemove = () => {
    const next = { ...(settings ?? {}), avatarUrl: null };
    updateSettings.mutate(next);
    onClose?.();
  };

  return (
    <Modal
      popupOpen={open}
      handleClose={onClose}
      additionalClasses="w-full max-w-3xl"
    >
      {/* Inside Modal — overlay already blurs the page behind. */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/98 shadow-2xl">
        {/* Atmospheric background accent */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-hanko/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-gold/10 blur-3xl" />

        <header className="relative border-b border-border/50 px-6 pt-6 pb-5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("avatar.label")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h2 className="mt-2 font-display text-2xl font-light italic leading-none tracking-tight text-washi md:text-3xl">
            {t("avatar.title")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("avatar.titleAccent")}
            </span>
          </h2>
          <p className="mt-2 max-w-lg text-sm text-washi-muted">
            {t("avatar.byline")}
          </p>

          {/* Controls row */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="group inline-flex cursor-pointer select-none items-center gap-2 rounded-full border border-border bg-ink-2/60 px-3 py-1.5 text-xs text-washi-muted transition hover:border-hanko/50 hover:text-washi">
              <input
                type="checkbox"
                checked={mainOnly}
                onChange={(e) => setMainOnly(e.target.checked)}
                className="h-3.5 w-3.5 accent-hanko"
              />
              <span className="font-mono uppercase tracking-wider">
                {t("avatar.mainOnly")}
              </span>
            </label>

            {currentAvatar && (
              <button
                onClick={handleRemove}
                className="inline-flex items-center gap-1.5 rounded-full border border-hanko/30 bg-hanko/5 px-3 py-1.5 text-xs font-medium text-hanko-bright transition hover:bg-hanko/15 hover:border-hanko"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                {t("avatar.remove")}
              </button>
            )}
          </div>
        </header>

        {/* Body */}
        <div className="relative max-h-[60vh] overflow-y-auto px-6 py-6">
          {!hasSources ? (
            <EmptyState t={t} reason="no-library" />
          ) : error === "jikan-rate-limit" && filteredGroups.length === 0 ? (
            <EmptyState t={t} reason="rate-limit" />
          ) : isLoading ? (
            <LoadingState />
          ) : filteredGroups.length === 0 ? (
            <EmptyState t={t} reason={mainOnly ? "no-main" : "empty"} />
          ) : (
            <div className="space-y-8">
              {filteredGroups.map((group) => (
                <GroupSection
                  key={group.mal_id}
                  group={group}
                  currentAvatar={currentAvatar}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}

          {isFetching && filteredGroups.length > 0 && (
            <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("avatar.stillFetching")}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function GroupSection({ group, currentAvatar, onSelect }) {
  return (
    <section>
      <header className="sticky top-0 z-10 -mx-6 mb-3 bg-ink-1/95 px-6 py-2 backdrop-blur">
        <div className="flex items-baseline gap-3">
          <h3 className="font-display text-sm font-semibold tracking-tight text-washi">
            {group.seriesName}
          </h3>
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
            {group.characters.length}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {group.characters.map((c) => {
          const isSelected = currentAvatar === c.imageUrl;
          return (
            <button
              key={c.mal_id}
              onClick={() => onSelect(c.imageUrl)}
              className={`group relative flex flex-col items-center gap-1.5 rounded-xl p-2 transition-transform hover:scale-[1.03] active:scale-95 ${
                isSelected
                  ? "ring-2 ring-hanko ring-offset-2 ring-offset-ink-1"
                  : ""
              }`}
              title={c.name}
              aria-label={`${c.name} — ${c.role}`}
            >
              <div
                className={`relative aspect-square w-full overflow-hidden rounded-full ring-1 transition-all ${
                  isSelected
                    ? "ring-hanko shadow-[0_0_24px_rgba(220,38,38,0.45)]"
                    : "ring-border group-hover:ring-hanko/70 group-hover:shadow-[0_0_16px_rgba(220,38,38,0.25)]"
                }`}
              >
                <img referrerPolicy="no-referrer"
                  src={c.imageUrl}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                {c.role === "Main" && (
                  <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-ink-0/80 to-transparent px-2 py-1 text-center font-mono text-[8px] uppercase tracking-[0.15em] text-gold">
                    main
                  </span>
                )}
              </div>
              <span className="line-clamp-1 max-w-full text-center text-[10px] text-washi-muted group-hover:text-washi">
                {c.name.split(",")[0]}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="space-y-8">
      {[0, 1].map((i) => (
        <section key={i}>
          <div className="mb-3 h-4 w-32 animate-shimmer rounded" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {Array.from({ length: 12 }).map((_, j) => (
              <div key={j} className="flex flex-col items-center gap-1.5 p-2">
                <Skeleton.Circle size={72} thickness={0} />
                <div className="h-3 w-16 animate-shimmer rounded" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EmptyState({ t, reason }) {
  const map = {
    "no-library": {
      icon: "⟡",
      title: t("avatar.emptyNoLibrary"),
      hint: t("avatar.emptyNoLibraryHint"),
    },
    "rate-limit": {
      icon: "※",
      title: t("avatar.emptyRateLimit"),
      hint: t("avatar.emptyRateLimitHint"),
    },
    "no-main": {
      icon: "❦",
      title: t("avatar.emptyNoMain"),
      hint: t("avatar.emptyNoMainHint"),
    },
    empty: {
      icon: "❦",
      title: t("avatar.emptyGeneric"),
      hint: t("avatar.emptyGenericHint"),
    },
  };
  const { icon, title, hint } = map[reason] ?? map.empty;
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span className="font-display text-6xl italic text-hanko/40">{icon}</span>
      <h3 className="font-display text-lg font-semibold italic text-washi">
        {title}
      </h3>
      <p className="max-w-sm text-sm text-washi-muted">{hint}</p>
    </div>
  );
}
