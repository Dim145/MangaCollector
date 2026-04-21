import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useKnownStores } from "@/hooks/useKnownStores.js";

/**
 * Store-input with typeahead against the list of stores the user has
 * already recorded anywhere in the app. A drop-in replacement for the
 * bare `<input type="text">` — same controlled API (`value` + `onChange`)
 * plus a `renderInputProps` escape hatch for when a parent needs to wire
 * extra attributes.
 *
 * Keyboard:
 *   - ArrowDown / ArrowUp navigate the suggestion list
 *   - Enter picks the active suggestion (falls through to form submit if none)
 *   - Escape closes the list
 * Mouse: click on a suggestion picks it.
 * Click-outside closes the list.
 *
 * The component does NOT constrain input — the user can type a brand-new
 * store name and it commits as-is. Suggestions only prevent accidental
 * duplicates ("Amazon" vs "amazon.fr" vs " Amazon").
 */
export default function StoreAutocomplete({
  id,
  value,
  onChange,
  placeholder,
  maxLength = 30,
  className = "",
  onBlur,
  disabled,
}) {
  const inputId = useId();
  const finalId = id ?? inputId;
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const knownStores = useKnownStores();

  const suggestions = useMemo(() => {
    const q = (value ?? "").trim().toLowerCase();
    const pool = knownStores ?? [];
    if (!q) return pool.slice(0, 8);
    // Case-insensitive substring match; hide an exact case-insensitive match
    // so the dropdown doesn't echo back what the user just typed.
    return pool
      .filter((s) => {
        const lc = s.toLowerCase();
        return lc.includes(q) && lc !== q;
      })
      .slice(0, 8);
  }, [value, knownStores]);

  // Close when clicking outside the field or dropdown
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target)
      ) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const pick = (val) => {
    onChange?.({ target: { value: val } });
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      e.preventDefault();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) =>
        suggestions.length === 0 ? -1 : (i + 1) % suggestions.length,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) =>
        suggestions.length === 0
          ? -1
          : (i - 1 + suggestions.length) % suggestions.length,
      );
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      pick(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  const showDropdown = open && suggestions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        id={finalId}
        type="text"
        autoComplete="off"
        value={value ?? ""}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => {
          onChange?.(e);
          setActiveIdx(-1);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={`${finalId}-suggestions`}
        className={className}
      />

      {showDropdown && (
        <ul
          id={`${finalId}-suggestions`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-ink-1/98 shadow-xl backdrop-blur-md animate-fade-in"
        >
          {suggestions.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={activeIdx === i}
              onMouseDown={(e) => {
                // mousedown fires before blur — prevents the click being
                // cancelled by the input losing focus.
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors ${
                activeIdx === i
                  ? "bg-hanko/15 text-washi"
                  : "text-washi-muted hover:bg-washi/5 hover:text-washi"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3 shrink-0 text-washi-dim"
                aria-hidden="true"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
              </svg>
              <span className="truncate">{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
