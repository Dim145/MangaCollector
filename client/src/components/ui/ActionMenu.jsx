import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  POPOVER_PANEL_CLASS,
  useAnchoredPopover,
} from "@/hooks/useAnchoredPopover.js";

/**
 * 他 · A row's secondary actions behind one "⋯" button, each one named in
 * words beside its glyph.
 *
 * The places page showed them as four bare glyphs (↑ ↓ 改 消): a reader
 * who does not read kanji had to hover each one to learn which deleted
 * the place, and a finger cannot hover. Here the glyph stays, the word
 * comes with it, and the destructive entry is set apart.
 *
 * A WAI-ARIA menu button on the native popover (`useAnchoredPopover`):
 * the menu opens on its first item, arrows / Home / End move, Escape
 * closes it and gives the focus back, Tab leaves and closes it.
 *
 * @param {object} props
 * @param {string} props.label  - what the button is for ("Actions — Shelf B")
 * @param {Array<{id: string, glyph?: string, label: string,
 *   onSelect: () => void, disabled?: boolean, danger?: boolean}>} props.items
 */
export default function ActionMenu({ label, items, disabled = false }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  useAnchoredPopover({ open, onClose: () => setOpen(false), buttonRef, panelRef: menuRef });

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector('[role="menuitem"]:not([disabled])')
      ?.focus({ preventScroll: true });
  }, [open]);

  const onKeyDown = (event) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const entries = [
      ...(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') ?? []),
    ];
    const at = entries.indexOf(document.activeElement);
    const next =
      event.key === "ArrowDown"
        ? (at + 1) % entries.length
        : event.key === "ArrowUp"
          ? (at - 1 + entries.length) % entries.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? entries.length - 1
              : -1;
    if (next < 0 || !entries.length) return;
    event.preventDefault();
    entries[next].focus();
  };

  const plain = items.filter((item) => !item.danger);
  const danger = items.filter((item) => item.danger);
  const renderItem = (item) => (
    <li key={item.id} role="none">
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        disabled={item.disabled}
        onClick={() => {
          setOpen(false);
          item.onSelect();
        }}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors focus-visible:-outline-offset-2 pointer-coarse:py-3 disabled:cursor-not-allowed disabled:opacity-40 ${
          item.danger
            ? "text-hanko-bright hover:bg-hanko/10 focus-visible:bg-hanko/10"
            : "text-washi hover:bg-washi/10 focus-visible:bg-washi/10"
        }`}
      >
        <span
          aria-hidden="true"
          className={`w-4 text-center font-jp text-[13px] leading-none ${
            item.danger ? "text-hanko-bright" : "text-washi-dim"
          }`}
        >
          {item.glyph}
        </span>
        {item.label}
      </button>
    </li>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid h-9 min-w-9 place-items-center rounded px-1.5 text-base leading-none text-washi-dim transition hover:text-washi pointer-coarse:h-11 pointer-coarse:min-w-11 disabled:opacity-30"
      >
        <span aria-hidden="true">⋯</span>
        <span className="sr-only">{label}</span>
      </button>
      {open &&
        createPortal(
          <ul
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            className={`${POPOVER_PANEL_CLASS} w-56 overflow-hidden rounded-xl border border-border bg-ink-2 py-1.5 shadow-2xl animate-slide-down`}
          >
            {plain.map(renderItem)}
            {danger.length > 0 && plain.length > 0 && (
              <li role="separator" className="my-1 h-px bg-border" />
            )}
            {danger.map(renderItem)}
          </ul>,
          document.body,
        )}
    </>
  );
}
