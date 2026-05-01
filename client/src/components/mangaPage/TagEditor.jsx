import { useMemo, useRef, useState } from "react";

/**
 * Inline tag editor for custom-only library rows.
 *
 * Activates when `isCustomGenresEditable` is true on MangaPage (mal_id <
 * 0 AND no mangadex_id). For every other row, genres render read-only
 * because a future `refresh-from-*` would clobber the edits — the
 * server enforces the same gate as a defence in depth.
 *
 * Behaviour:
 *   · Each chip carries a hover-revealed `×` to drop that tag.
 *   · A trailing "+ Ajouter" button toggles into a small input.
 *   · The input shows up to 8 autocomplete suggestions sourced from the
 *     UNION of every genre present elsewhere in the user's library
 *     (case-insensitive matching, but the suggestion preserves the
 *     existing casing so the user's earlier choice wins).
 *   · Enter / suggestion-click adds. Escape / blur cancels.
 *   · Hard cap of 30 tags per row + 40 chars per tag (mirrors the
 *     server's `sanitize_genres` so the UI doesn't promise what the
 *     server will refuse).
 *
 * `onChange` receives the new full list and is responsible for both
 * the local state update AND the server mutation (the parent passes
 * `(next) => { setGenres(next); updateMangaMeta.mutate({ genres: next }); }`).
 */
const TAG_MAX_LEN = 40;
const TAGS_MAX_COUNT = 30;
const SUGGESTION_LIMIT = 8;

export default function TagEditor({ genres, library, onChange, t }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  // Pool of every genre seen anywhere else in the user's library, minus
  // the ones already on this row. Built case-insensitive so adding
  // "shōnen" when the library has "Shōnen" doesn't double-suggest it.
  const allTags = useMemo(() => {
    const seen = new Map(); // lowercase → original casing (first seen wins)
    (library ?? []).forEach((m) => {
      (m.genres ?? []).forEach((g) => {
        const trimmed = (g ?? "").trim();
        if (!trimmed) return;
        const lc = trimmed.toLowerCase();
        if (!seen.has(lc)) seen.set(lc, trimmed);
      });
    });
    const currentLc = new Set(genres.map((g) => g.toLowerCase()));
    return [...seen.entries()]
      .filter(([lc]) => !currentLc.has(lc))
      .map(([, label]) => label)
      .sort((a, b) => a.localeCompare(b));
  }, [library, genres]);

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return allTags.slice(0, SUGGESTION_LIMIT);
    return allTags
      .filter((tag) => tag.toLowerCase().includes(q))
      .slice(0, SUGGESTION_LIMIT);
  }, [draft, allTags]);

  const atCap = genres.length >= TAGS_MAX_COUNT;

  const remove = (g) => {
    const next = genres.filter((x) => x !== g);
    onChange(next);
  };

  const add = (raw) => {
    const trimmed = (raw ?? "").trim().slice(0, TAG_MAX_LEN);
    if (!trimmed) return;
    if (genres.some((g) => g.toLowerCase() === trimmed.toLowerCase())) {
      // Already present; close the input but keep the existing entry.
      setDraft("");
      setAdding(false);
      return;
    }
    if (atCap) return;
    onChange([...genres, trimmed]);
    setDraft("");
    setAdding(false);
  };

  const beginAdd = () => {
    if (atCap) return;
    setAdding(true);
    // Defer focus until after the input mounts.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cancelAdd = () => {
    setAdding(false);
    setDraft("");
  };

  return (
    <div className="mt-5 flex flex-wrap items-center gap-1.5">
      {genres.map((genre) => (
        <span
          key={`genre-${genre}`}
          className="group inline-flex items-center gap-1 rounded-full border border-border bg-ink-1/60 py-0.5 pl-2.5 pr-1 font-mono text-[10px] uppercase tracking-wider text-washi-muted backdrop-blur transition hover:border-hanko/40 hover:text-washi"
        >
          <span>{genre}</span>
          <button
            type="button"
            onClick={() => remove(genre)}
            aria-label={t("manga.removeTag")}
            title={t("manga.removeTag")}
            className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-washi-dim transition hover:bg-hanko/25 hover:text-hanko-bright"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-2.5 w-2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}

      {adding ? (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, TAG_MAX_LEN))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelAdd();
              }
            }}
            onBlur={() => {
              // Delay the close so a click on a suggestion lands first.
              // 120ms is enough for a fast click, short enough that an
              // accidental focus-out feels responsive.
              setTimeout(cancelAdd, 120);
            }}
            placeholder={t("manga.addTagPlaceholder")}
            maxLength={TAG_MAX_LEN}
            className="w-44 rounded-full border border-hanko/40 bg-ink-2/80 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-washi placeholder:text-washi-dim placeholder:normal-case placeholder:tracking-normal focus:border-hanko focus:outline-none focus:ring-1 focus:ring-hanko/40"
          />
          {suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute left-0 top-full z-20 mt-1 max-h-60 min-w-full overflow-auto rounded-md border border-border bg-ink-1/95 shadow-xl backdrop-blur animate-fade-in"
            >
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    // onMouseDown so the click fires *before* the input's
                    // onBlur cancellation. Without this, blur cancels the
                    // edit before the click handler ever runs.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(s);
                    }}
                    className="block w-full px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-washi-muted transition hover:bg-hanko/15 hover:text-washi"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={beginAdd}
          disabled={atCap}
          title={
            atCap
              ? t("manga.addTag") + " · " + TAGS_MAX_COUNT + "/" + TAGS_MAX_COUNT
              : t("manga.addTag")
          }
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-hanko/40 bg-hanko/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-hanko-bright transition hover:border-hanko hover:bg-hanko/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true" className="leading-none">
            +
          </span>
          {t("manga.addTag")}
        </button>
      )}
    </div>
  );
}
