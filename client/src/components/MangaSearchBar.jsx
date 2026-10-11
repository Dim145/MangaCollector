import { useEffect, useRef } from "react";
import { detectPasteIntent } from "@/lib/pasteDetect.js";
import { useT } from "@/i18n/index.jsx";

export default function MangaSearchBar({
  query,
  setQuery,
  searchManga,
  clearResults,
  loading,
  hasResults,
  placeholder,
  clearText,
  additionalButtons,
  // 即 · The dashboard filters as you type; a "Search" button there
  // only promised a step that never happens. Off, the input gets its
  // right padding back and the clear cross moves to the edge.
  showSubmit = true,
  // Tour-friendly opt-in: when true, the input receives focus on mount.
  // Used by the welcome tour's "Add your first series" step so the
  // user lands ready-to-type instead of having to find the input first.
  autoFocus = false,
  // 貼 · Optional callback fired when a paste matches a known shape
  // (MAL / MangaDex / AniList URL, ISBN). Receives `{ kind, query }`.
  // When set, the native paste is preventDefault'd and the consumer
  // is in charge of populating the input + triggering the search.
  // Dashboard's local-filter input doesn't pass this — it lets the
  // raw text land in the field for fuzzy in-memory matching.
  onPasteIntent,
  // 横 · Keep the field and its buttons on one row at every width. The
  // dashboard passes it: on a phone its one button ("Filters") fits
  // beside the field, and a row of its own cost 50 px above the shelf.
  inlineActions = false,
}) {
  const t = useT();
  const inputRef = useRef(null);

  // Effect-based focus rather than the native `autoFocus` attribute —
  // gives us a stable timing handle (we run after layout) and lets us
  // pair it with `scrollIntoView` so the input is also visible, not just
  // focused under a sticky header.
  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;
    // RAF defers focus by one frame so any route-transition layout
    // settles first (otherwise mobile browsers occasionally miss the
    // focus and never raise the soft keyboard).
    const raf = requestAnimationFrame(() => {
      try {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        /* old browsers without preventScroll — fall back to plain focus */
        el.focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [autoFocus]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchManga();
    }
  };

  const handlePaste = (e) => {
    if (!onPasteIntent) return;
    const pasted = e.clipboardData?.getData("text");
    const intent = detectPasteIntent(pasted);
    if (!intent) return;
    e.preventDefault();
    onPasteIntent(intent);
  };

  return (
    <div
      className={
        inlineActions
          ? "flex items-center gap-2 sm:gap-3"
          : "flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3"
      }
    >
      {/* Search Input */}
      <div className="group relative min-w-0 flex-1">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-washi-dim group-focus-within:text-hanko-bright transition-colors">
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder || t("common.search")}
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className={`w-full text-ellipsis rounded-full border border-border bg-ink-1/60 py-3 pl-12 text-sm text-washi placeholder:text-washi-dim backdrop-blur-md transition-all focus:border-hanko/50 focus:bg-ink-1/90 focus:outline-none focus:ring-2 focus:ring-hanko/30 ${showSubmit ? "pr-28" : "pr-11"}`}
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label={t("common.clear")}
            className={`absolute top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full text-washi-dim transition hover:text-washi hover:bg-washi/10 pointer-coarse:h-11 pointer-coarse:w-11 ${showSubmit ? "right-28" : "right-2"}`}
            tabIndex={-1}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        {showSubmit && (
        <button
          onClick={searchManga}
          disabled={loading}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-full bg-hanko px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-on-hanko transition-all hover:bg-hanko-deep active:scale-95 disabled:opacity-60"
        >
          {loading ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
              <span className="hidden sm:inline">…</span>
            </>
          ) : (
            t("common.search")
          )}
        </button>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 sm:gap-3">
        {additionalButtons}

        {hasResults && (
          <button
            onClick={clearResults}
            // In one row on a phone the field's own × clears it; a second
            // "clear" button would only squeeze the field.
            className={`${inlineActions ? "hidden sm:inline-flex" : "inline-flex"} flex-1 items-center justify-center gap-1.5 rounded-full border border-border bg-ink-1/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/50 hover:text-washi sm:flex-none`}
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
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
            {clearText || t("common.clear")}
          </button>
        )}
      </div>
    </div>
  );
}
