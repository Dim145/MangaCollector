import { useState } from "react";

/**
 * CSS-only tooltip wrapper — shows a styled bubble on hover/focus. Reliable
 * across browsers in cases where the native `title` attribute misbehaves
 * (absolute-positioned decorative spans, portaled modals, etc.).
 *
 * Usage:
 *   <Tooltip text="Édition collector">
 *     <span>限</span>
 *   </Tooltip>
 *
 * Placement: "top" (default) | "bottom" | "left" | "right".
 * Renders a sibling bubble, positioned relative to a thin inline-flex
 * wrapper.
 *
 * 示 · What WCAG 1.4.13 asks of content shown on hover or focus:
 *   - dismissible — Escape hides it without moving the pointer or the
 *     focus, until the pointer leaves or the focus moves on;
 *   - hoverable — once shown, the bubble takes the pointer, so moving
 *     onto it (across the 6 px gap, inside the 200 ms the fade waits)
 *     keeps it open; hidden, it lets every click through;
 *   - persistent — it stays while hovered or focused.
 * The bubble is a visual echo, hidden from assistive technology: every
 * trigger carries the same words as its own name.
 */
export default function Tooltip({ text, children, placement = "top" }) {
  const [dismissed, setDismissed] = useState(false);
  if (!text) return children;

  const position = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
  }[placement];

  // Small arrow pointing at the target — picks the side opposite the bubble.
  const arrow = {
    top: "after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-[5px] after:border-transparent after:border-t-ink-1",
    bottom:
      "after:absolute after:left-1/2 after:bottom-full after:-translate-x-1/2 after:border-[5px] after:border-transparent after:border-b-ink-1",
    left: "after:absolute after:left-full after:top-1/2 after:-translate-y-1/2 after:border-[5px] after:border-transparent after:border-l-ink-1",
    right:
      "after:absolute after:right-full after:top-1/2 after:-translate-y-1/2 after:border-[5px] after:border-transparent after:border-r-ink-1",
  }[placement];

  return (
    <span
      className="group/tooltip relative inline-flex"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !dismissed) {
          event.stopPropagation();
          setDismissed(true);
        }
      }}
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
    >
      {children}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute z-[2147483640] whitespace-nowrap rounded-md border border-border bg-ink-1/98 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-washi opacity-0 shadow-xl backdrop-blur transition-all duration-200 delay-200 ${
          dismissed
            ? ""
            : "group-hover/tooltip:pointer-events-auto group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
        } ${position} ${arrow}`}
      >
        {text}
      </span>
    </span>
  );
}
