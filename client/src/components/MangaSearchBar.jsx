import { useEffect, useRef } from "react";
import { detectPasteIntent } from "@/lib/pasteDetect.js";

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
}) {
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
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
      {/* Search Input */}
      <div className="group relative flex-1">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-washi-dim group-focus-within:text-hanko transition-colors">
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
          placeholder={placeholder || "Search manga…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="w-full rounded-full border border-border bg-ink-1/60 py-3 pl-12 pr-28 text-sm text-washi placeholder:text-washi-dim backdrop-blur-md transition-all focus:border-hanko/50 focus:bg-ink-1/90 focus:outline-none focus:ring-2 focus:ring-hanko/30"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label="Clear"
            className="absolute right-28 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full text-washi-dim transition hover:text-washi hover:bg-washi/10"
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
        <button
          onClick={searchManga}
          disabled={loading}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-full bg-hanko px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-washi transition-all hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
        >
          {loading ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
              <span className="hidden sm:inline">…</span>
            </>
          ) : (
            "Search"
          )}
        </button>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 sm:gap-3">
        {additionalButtons}

        {hasResults && (
          <button
            onClick={clearResults}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border bg-ink-1/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/50 hover:text-washi sm:flex-none"
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
            {clearText || "Clear"}
          </button>
        )}
      </div>
    </div>
  );
}
