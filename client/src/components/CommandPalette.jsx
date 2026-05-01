import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "./ui/Modal.jsx";
import SettingsContext from "@/SettingsContext.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { hasToBlurImage } from "@/utils/library.js";
import { useT } from "@/i18n/index.jsx";

/**
 * 検 · Command palette — power-user fast-nav.
 *
 * Opens on `⌘K` (Mac) / `Ctrl+K` (everywhere else). Lists:
 *   • Static navigation entries (Dashboard, Add, Calendar, Profile,
 *     Settings, Glossary, Seals).
 *   • Series from the user's library, filtered by the typed query
 *     (substring match on the title, case-insensitive). Capped at
 *     10 results so the list stays scannable on large libraries.
 *
 * Keyboard:
 *   • Open: ⌘K / Ctrl+K
 *   • Navigate: ↓ / ↑
 *   • Pick: Enter
 *   • Close: Esc (handled by the underlying Modal)
 *
 * Mounted once at app root (App.jsx) so the shortcut works from
 * anywhere — same global lifecycle as `<OfflineBanner>` and
 * `<SyncToaster>`.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const navigate = useNavigate();
  const t = useT();
  const { data: library } = useLibrary();
  const { adult_content_level } = useContext(SettingsContext);

  // Global ⌘K / Ctrl+K handler. Also blocked when the user is typing
  // inside an editable field (input/textarea/contenteditable) so the
  // shortcut doesn't shadow native browser shortcuts inside a search
  // box that already binds Ctrl+K (e.g. some autocomplete widgets).
  useEffect(() => {
    const onKey = (e) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (!isCmdK) return;
      e.preventDefault();
      setOpen((prev) => !prev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Static navigation entries. The path values match the routes
  // declared in App.jsx — keep them in sync if routes ever move.
  const navItems = useMemo(
    () => [
      { id: "nav-dashboard", kanji: "棚", label: t("palette.navDashboard"), path: "/dashboard" },
      { id: "nav-add", kanji: "加", label: t("palette.navAdd"), path: "/addmanga" },
      { id: "nav-calendar", kanji: "暦", label: t("palette.navCalendar"), path: "/calendrier" },
      { id: "nav-profile", kanji: "個", label: t("palette.navProfile"), path: "/profile" },
      { id: "nav-seals", kanji: "印", label: t("palette.navSeals"), path: "/seals" },
      { id: "nav-settings", kanji: "設", label: t("palette.navSettings"), path: "/settings" },
      { id: "nav-glossary", kanji: "字", label: t("palette.navGlossary"), path: "/glossary" },
    ],
    [t],
  );

  // Combined item list: filter by query, navigation first then series.
  // Series are capped at 10 even with no query so the panel doesn't
  // become a wall of text on large libraries.
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesNav = q
      ? navItems.filter((n) => n.label.toLowerCase().includes(q))
      : navItems;
    const matchesSeries = (library ?? [])
      .filter((m) => {
        if (!m?.name) return false;
        if (q && !m.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .slice(0, 10)
      .map((m) => ({
        id: `series-${m.mal_id ?? m.id}`,
        kanji: "巻",
        label: m.name,
        path: "/mangapage",
        manga: m,
      }));
    return [...matchesNav, ...matchesSeries];
  }, [query, library, navItems]);

  // Reset selection when the list shape changes (new query).
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Focus the input on open. Modal already manages focus-trap; this
  // belt-and-braces ensures the caret lands in the search field
  // (Modal would otherwise fall through to the first tabbable, which
  // happens to be the X close button rendered by Modal itself).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Reset query on close so re-opening starts fresh. Defer one tick
  // so the Modal's exit animation doesn't see the items list shrink
  // mid-flight.
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setQuery(""), 250);
    return () => clearTimeout(id);
  }, [open]);

  // Keep the active item scrolled into view as the user navigates
  // with arrow keys. `block: "nearest"` avoids a jarring centre-jump
  // when the active item is already partially visible.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.querySelector(`[data-active="true"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const handleSelect = (item) => {
    if (!item) return;
    setOpen(false);
    if (item.path === "/mangapage" && item.manga) {
      navigate(item.path, {
        state: { manga: item.manga, adult_content_level },
        viewTransition: true,
      });
    } else if (item.path) {
      navigate(item.path, { viewTransition: true });
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(items[activeIndex]);
    }
  };

  return (
    <Modal
      popupOpen={open}
      handleClose={() => setOpen(false)}
      additionalClasses="w-full max-w-xl"
    >
      <div className="relative flex max-h-[70dvh] flex-col overflow-hidden rounded-2xl border border-border bg-ink-1/98 shadow-2xl">
        {/* 検 watermark — same kanji-poster vocabulary as other modals */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-6 -right-2 select-none font-jp text-[14rem] font-bold leading-none text-hanko/[0.05]"
          style={{ writingMode: "vertical-rl" }}
        >
          検
        </span>

        {/* Search input */}
        <div className="relative z-10 flex items-center gap-3 border-b border-border/60 px-5 py-4">
          <span
            aria-hidden="true"
            className="font-jp text-lg font-bold leading-none text-hanko"
          >
            検
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            data-autofocus
            className="min-w-0 flex-1 bg-transparent font-display text-base text-washi placeholder:text-washi-dim focus:outline-none"
          />
          <kbd className="hidden rounded border border-border bg-ink-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-washi-dim sm:inline">
            ESC
          </kbd>
        </div>

        {/* Items list */}
        <div
          ref={listRef}
          role="listbox"
          aria-label={t("palette.placeholder")}
          className="relative z-10 min-h-0 flex-1 overflow-y-auto py-2"
        >
          {items.length === 0 ? (
            <p className="px-5 py-6 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
              {t("palette.empty")}
            </p>
          ) : (
            <ul role="presentation">
              {items.map((item, i) => {
                const isActive = i === activeIndex;
                const isSeries = item.id.startsWith("series-");
                const blurred =
                  isSeries && hasToBlurImage(item.manga, adult_content_level);
                return (
                  <li key={item.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      // mousedown fires before blur — prevents the click
                      // being cancelled by the input losing focus.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(item);
                      }}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition ${
                        isActive
                          ? "bg-hanko/15 text-washi"
                          : "text-washi-muted hover:bg-washi/5 hover:text-washi"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md font-jp text-sm font-bold leading-none transition ${
                          isActive
                            ? "bg-hanko/30 text-hanko-bright"
                            : "bg-ink-2/60 text-washi-dim"
                        }`}
                      >
                        {item.kanji}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate font-display text-sm ${
                          isSeries ? "" : "italic"
                        } ${blurred ? "blur-sm" : ""}`}
                      >
                        {item.label}
                      </span>
                      {isSeries && (
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.22em] text-washi-dim">
                          {t("palette.seriesTag")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="relative z-10 flex items-center justify-between gap-2 border-t border-border/60 bg-ink-1/60 px-5 py-2 font-mono text-[9px] uppercase tracking-[0.22em] text-washi-dim">
          <span>
            <kbd className="rounded border border-border bg-ink-2/80 px-1 py-0.5 text-washi-muted">
              ↑↓
            </kbd>{" "}
            {t("palette.hintNavigate")}
          </span>
          <span>
            <kbd className="rounded border border-border bg-ink-2/80 px-1 py-0.5 text-washi-muted">
              {navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl"}
              +K
            </kbd>{" "}
            {t("palette.hintToggle")}
          </span>
        </div>
      </div>
    </Modal>
  );
}
