import { useDeferredValue, useMemo, useState } from "react";
import Modal from "./ui/Modal.jsx";
import { useAvatarChoices } from "@/hooks/useAvatarChoices.js";
import { useUpdateSettings, useUserSettings } from "@/hooks/useSettings.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 顔 · Avatar picker — circular ledger with hanko seals.
 *
 * Bugs the original had — and how this rewrite addresses each:
 *   1. `ring-offset-*` on a `rounded-full` element drew a SQUARE halo
 *      (the offset is a square box-shadow). → ring sits on the same
 *      `rounded-full` element, no offset; the box-shadow respects the
 *      circle exactly.
 *   2. Native `title={c.name}` orphaned an OS tooltip on touch devices
 *      that emulate hover. → tooltip removed; the name lives below the
 *      circle anyway.
 *   3. MAIN role band painted INSIDE the round mask got clipped on
 *      portraits that didn't fill to the bottom. → MAIN becomes a
 *      rotated stamp anchored to the bounding-box corner (which is
 *      visually empty on a circle), so nothing is ever clipped.
 *   4. Tile labels showed only the surname — "Greyrat / Greyrat" for
 *      Roxy and Rudeus was indistinguishable. → MAL stores names as
 *      "Family, Given"; we reverse to Western order ("Rudeus Greyrat")
 *      so the *given* name leads.
 *   5. Clicking a portrait closed the modal — disorienting if the user
 *      wanted to compare options. → save-on-click, modal STAYS OPEN; the
 *      印 seal jumps to the new selection as instant visual confirmation.
 *      X / Escape / overlay-click close.
 *
 * Layout:
 *   • Header — eyebrow + title + byline (existing voice).
 *   • Filter row — live search + main-only toggle + remove button.
 *   • Series chip-rail — horizontal scroll, scopes the grid to one
 *     series; "All" restores the full ledger. Mobile: only nav element
 *     above the grid (no sidebar to compete with the small viewport).
 *   • Body — circular avatar tiles. Each has:
 *       - a rotated 主 stamp (top-left) when role === "Main"
 *       - a rotated 印 seal (top-right) when this is the current avatar
 *       - the full Western-ordered name beneath
 *
 * Mobile: tiles stay 3-up so faces are recognisable, filter row stacks
 * (search above, toggles below), modal flexes to 88dvh and the body
 * scrolls internally so header + chip-rail stay anchored.
 */
export default function AvatarPicker({ open, onClose }) {
  const t = useT();
  const { groups, isLoading, isFetching, hasSources, error } = useAvatarChoices(
    { sourceLimit: 10 },
  );
  const { data: settings } = useUserSettings();
  const updateSettings = useUpdateSettings();

  const [mainOnly, setMainOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [activeSeries, setActiveSeries] = useState("all");
  // Defer the query so React can keep typing reactive while the (possibly
  // 100+ character) filter recomputes in a transition.
  const deferredQuery = useDeferredValue(query);

  const currentAvatar = settings?.avatarUrl ?? null;

  // Apply main-only first; the chip-rail counts reflect this filter so
  // chips show the count the user will *actually* see when they click.
  const mainFiltered = useMemo(() => {
    if (!mainOnly) return groups;
    return groups
      .map((g) => ({
        ...g,
        characters: g.characters.filter((c) => c.role === "Main"),
      }))
      .filter((g) => g.characters.length > 0);
  }, [groups, mainOnly]);

  // Apply series scope + name search on top.
  const visibleGroups = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let work = mainFiltered;
    if (activeSeries !== "all") {
      work = work.filter((g) => g.mal_id === activeSeries);
    }
    if (q) {
      work = work
        .map((g) => ({
          ...g,
          characters: g.characters.filter((c) =>
            c.name.toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.characters.length > 0);
    }
    return work;
  }, [mainFiltered, deferredQuery, activeSeries]);

  const totalVisible = useMemo(
    () => visibleGroups.reduce((acc, g) => acc + g.characters.length, 0),
    [visibleGroups],
  );

  // Save-on-click WITHOUT closing the modal — selection persists in the
  // background and the 印 seal jumps to the freshly-clicked tile so the
  // user *sees* what they just picked. Closing happens via the X / Escape /
  // overlay-click only. Picking the already-current avatar is a no-op
  // (avoids spurious mutations / round-trips).
  const handleSelect = (imageUrl) => {
    if (currentAvatar === imageUrl) return;
    const next = { ...(settings ?? {}), avatarUrl: imageUrl };
    updateSettings.mutate(next);
  };

  const handleRemove = () => {
    if (!currentAvatar) return;
    const next = { ...(settings ?? {}), avatarUrl: null };
    updateSettings.mutate(next);
  };

  // Reasons to render the FULL-BLEED empty state (search/filters can't
  // help — there's literally no data to filter from).
  const initialEmpty = !hasSources
    ? "no-library"
    : error === "jikan-rate-limit" && groups.length === 0
      ? "rate-limit"
      : null;

  // Reasons to render an INLINE empty state (scaffolding stays — search
  // and filters remain reachable so the user can recover).
  const inlineEmpty =
    !isLoading && !initialEmpty && visibleGroups.length === 0
      ? deferredQuery.trim()
        ? "no-search"
        : mainOnly
          ? "no-main"
          : "empty"
      : null;

  return (
    <Modal
      popupOpen={open}
      handleClose={onClose}
      additionalClasses="w-full max-w-3xl"
    >
      <div className="relative flex max-h-[88dvh] flex-col overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-ink-1 via-ink-1/95 to-ink-0 shadow-2xl">
        {/* Atmospheric accents — corner blooms. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -right-32 h-72 w-72 rounded-full bg-hanko/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-gold/10 blur-3xl"
        />

        {/* Watermark — 顔 (kao, "face"). */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-4 -right-2 select-none font-display italic font-light leading-none text-hanko/[0.06]"
          style={{ fontSize: "11rem" }}
        >
          顔
        </span>

        {/* === HEADER === */}
        <header className="relative z-[1] shrink-0 border-b border-border/40 px-5 pt-6 pb-4 sm:px-7 sm:pt-7 sm:pb-5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
              {t("avatar.label")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-hanko/30 via-border to-transparent" />
          </div>
          <h2
            data-autofocus
            tabIndex={-1}
            className="mt-2 font-display text-2xl font-light italic leading-tight text-washi md:text-3xl"
          >
            {t("avatar.title")}{" "}
            <span className="text-hanko-gradient font-semibold not-italic">
              {t("avatar.titleAccent")}
            </span>
          </h2>
          <p className="mt-2 max-w-lg text-sm text-washi-muted">
            {t("avatar.byline")}
          </p>

          {/* Filters row — only renders when we have at least *some* data
              to filter (no point showing search on the no-library state). */}
          {!initialEmpty && (
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
              {/* Search */}
              <label className="group relative flex-1">
                <span className="sr-only">{t("avatar.searchAria")}</span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-washi-dim transition-colors group-focus-within:text-hanko"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("avatar.searchPlaceholder")}
                  aria-label={t("avatar.searchAria")}
                  className="w-full rounded-full border border-border bg-ink-2/60 py-2 pl-9 pr-9 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/60 focus:bg-ink-2/90 focus:outline-none focus:ring-2 focus:ring-hanko/30"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label={t("avatar.searchClear")}
                    className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-washi-dim transition hover:bg-hanko/10 hover:text-hanko-bright"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </label>

              {/* Main-only toggle */}
              <label className="inline-flex shrink-0 cursor-pointer select-none items-center gap-2 rounded-full border border-border bg-ink-2/60 px-3 py-2 text-xs text-washi-muted transition hover:border-hanko/50 hover:text-washi sm:py-1.5">
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

              {/* Remove avatar — only when one is currently set. */}
              {currentAvatar && (
                <button
                  type="button"
                  onClick={handleRemove}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hanko/30 bg-hanko/5 px-3 py-2 text-xs font-medium text-hanko-bright transition hover:bg-hanko/15 hover:border-hanko sm:py-1.5"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
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
          )}
        </header>

        {/* === SERIES CHIP RAIL === */}
        {!initialEmpty && mainFiltered.length > 1 && (
          <nav
            aria-label={t("avatar.seriesNavLabel")}
            className="relative z-[1] shrink-0 border-b border-border/30 bg-ink-1/50 px-5 py-2.5 sm:px-7"
          >
            <ul
              role="list"
              className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <li>
                <SeriesChip
                  active={activeSeries === "all"}
                  onClick={() => setActiveSeries("all")}
                  label={t("avatar.allSeries")}
                  count={mainFiltered.reduce(
                    (acc, g) => acc + g.characters.length,
                    0,
                  )}
                />
              </li>
              {mainFiltered.map((g) => (
                <li key={g.mal_id}>
                  <SeriesChip
                    active={activeSeries === g.mal_id}
                    onClick={() => setActiveSeries(g.mal_id)}
                    label={g.seriesName}
                    count={g.characters.length}
                    aria-label={t("avatar.seriesJumpAria", {
                      name: g.seriesName,
                    })}
                  />
                </li>
              ))}
            </ul>
          </nav>
        )}

        {/* === BODY === */}
        <div className="relative z-[1] flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {initialEmpty ? (
            <EmptyState t={t} reason={initialEmpty} />
          ) : isLoading ? (
            <LoadingState />
          ) : inlineEmpty ? (
            <EmptyState t={t} reason={inlineEmpty} query={deferredQuery} />
          ) : (
            <>
              {/* Total-count line — gives a sense of scale and confirms
                  filters are applied without noisy chrome. */}
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
                {t("avatar.countCharacters", { n: totalVisible })}
              </p>

              <div
                className={visibleGroups.length > 1 ? "space-y-7" : ""}
              >
                {visibleGroups.map((group) => (
                  <GroupSection
                    key={group.mal_id}
                    group={group}
                    showHeader={visibleGroups.length > 1}
                    currentAvatar={currentAvatar}
                    onSelect={handleSelect}
                    t={t}
                  />
                ))}
              </div>

              {isFetching && (
                <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                  {t("avatar.stillFetching")}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SeriesChip({ active, onClick, label, count, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-hanko focus-visible:ring-offset-2 focus-visible:ring-offset-ink-1 ${
        active
          ? "border-hanko bg-hanko/15 text-washi shadow-[0_0_18px_rgba(220,38,38,0.25)]"
          : "border-border bg-ink-2/40 text-washi-muted hover:border-hanko/50 hover:bg-hanko/5 hover:text-washi"
      }`}
      {...rest}
    >
      <span className="max-w-[14ch] truncate sm:max-w-[20ch]">{label}</span>
      <span
        className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] tracking-wider ${
          active
            ? "bg-hanko/30 text-washi"
            : "bg-ink-1/60 text-washi-dim group-hover:bg-hanko/20 group-hover:text-washi-muted"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function GroupSection({ group, showHeader, currentAvatar, onSelect, t }) {
  return (
    <section>
      {showHeader && (
        <header className="mb-3 flex items-baseline gap-3">
          <h3 className="font-display text-base font-semibold italic tracking-tight text-washi">
            {group.seriesName}
          </h3>
          <span className="h-px flex-1 bg-gradient-to-r from-border via-border/60 to-transparent" />
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
            {group.characters.length}
          </span>
        </header>
      )}

      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6">
        {group.characters.map((c) => (
          <CharacterTile
            key={c.mal_id}
            character={c}
            selected={currentAvatar === c.imageUrl}
            onSelect={() => onSelect(c.imageUrl)}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

function CharacterTile({ character, selected, onSelect, t }) {
  const display = formatName(character.name);
  const isMain = character.role === "Main";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${character.name} — ${character.role}`}
      aria-pressed={selected}
      className="group relative flex w-full flex-col items-center gap-2 rounded-2xl px-1 py-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-hanko focus-visible:ring-offset-2 focus-visible:ring-offset-ink-1"
    >
      {/* Bounding-box wrapper — the circle lives inside, the corner
          stamps are anchored against the box's actual corners (which are
          visually empty space outside the circle). */}
      <div className="relative w-full">
        {/* The circle itself. The ring sits on this `rounded-full`
            element, so its box-shadow traces the circle exactly — no
            square halo, which was the bug in the previous implementation
            (ring-offset-* paints a square at the offset distance,
            ignoring border-radius). */}
        <div
          className={`relative mx-auto aspect-square w-full overflow-hidden rounded-full bg-ink-2 transition duration-300 ${
            selected
              ? "ring-2 ring-hanko shadow-[0_0_24px_rgba(220,38,38,0.45)]"
              : "ring-1 ring-border group-hover:ring-hanko/55 group-hover:shadow-[0_0_16px_rgba(220,38,38,0.18)]"
          }`}
        >
          <img
            referrerPolicy="no-referrer"
            src={character.imageUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
          {/* Subtle vignette inside the circle — focuses attention on the
              face, especially on light/washed-out portraits. */}
          <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_-30px_40px_-30px_rgba(0,0,0,0.55)]" />
        </div>

        {/* MAIN stamp — anchored to the top-left corner of the bounding
            box. The corner is visually outside the circle (empty
            triangle), so the stamp reads as if pressed onto the photo at
            that corner without overlapping the face. */}
        {isMain && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 grid h-7 w-7 place-items-center rounded-full bg-hanko/95 font-jp text-[12px] font-bold leading-none text-washi shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-2 ring-ink-1"
            style={{ transform: "rotate(-10deg)" }}
            title={t("avatar.mainBadge")}
          >
            主
          </span>
        )}

        {/* SELECTED seal — anchored opposite (top-right). The fade-up
            animation makes the save-on-click feel decisive: the seal
            "lands" on the freshly-chosen avatar. */}
        {selected && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-0 grid h-7 w-7 place-items-center rounded-full bg-hanko font-jp text-[12px] font-bold leading-none text-washi shadow-[0_3px_12px_rgba(0,0,0,0.55)] ring-2 ring-ink-1 animate-fade-up"
            style={{ transform: "rotate(8deg)" }}
          >
            印
          </span>
        )}
      </div>

      {/* Name — Western-ordered, two-line max so neither given nor
          family name truncates mid-word on long combos like
          "Roxy Migurdia Greyrat". */}
      <span
        className={`line-clamp-2 w-full px-0.5 text-center text-[11px] leading-tight transition ${
          selected
            ? "font-semibold text-washi"
            : "text-washi-muted group-hover:text-washi"
        }`}
      >
        {display}
      </span>
    </button>
  );
}

/**
 * Reformat a Jikan-style "Family, Given" name into Western order.
 *
 * Examples:
 *   "Greyrat, Rudeus"           → "Rudeus Greyrat"
 *   "Greyrat, Roxy Migurdia"    → "Roxy Migurdia Greyrat"
 *   "Lawliet, L"                → "L Lawliet"
 *   "Crocodile"                 → "Crocodile"        (no comma)
 *   "Greyrat, Rudeus, II"       → "Greyrat Rudeus II" (>2 parts: just join)
 *
 * Why reverse? MAL's canonical storage is family-first (Japanese order),
 * but Western readers look for the *given* name to identify a character
 * — "Rudeus" reads instantly, "Greyrat" is just the family. For pen
 * names with multiple commas we fall back to a comma-stripped join
 * rather than guess.
 */
function formatName(raw) {
  if (!raw) return "";
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  return parts.join(" ");
}

function LoadingState() {
  return (
    <div className="space-y-7">
      {[0, 1].map((i) => (
        <section key={i}>
          <div className="mb-3 flex items-baseline gap-3">
            <div className="h-4 w-32 animate-shimmer rounded" />
            <div className="h-px flex-1 bg-border/40" />
          </div>
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, j) => (
              <div
                key={j}
                className="flex flex-col items-center gap-2 px-1 py-2"
                style={{ animationDelay: `${j * 35}ms` }}
              >
                <div className="aspect-square w-full animate-shimmer rounded-full ring-1 ring-border" />
                <div className="h-3 w-2/3 animate-shimmer rounded" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EmptyState({ t, reason, query }) {
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
    "no-search": {
      icon: "✕",
      title: t("avatar.emptyNoSearch"),
      hint: t("avatar.emptyNoSearchHint", { q: query ?? "" }),
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
      <span className="font-display text-6xl italic text-hanko/40">
        {icon}
      </span>
      <h3 className="font-display text-lg font-semibold italic text-washi">
        {title}
      </h3>
      <p className="max-w-sm text-sm text-washi-muted">{hint}</p>
    </div>
  );
}
