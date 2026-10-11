import { useRef, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPinned, useAnchoredPopover } from "./useAnchoredPopover.js";

/*
 * The hook has two paths. jsdom has no popover API, so every component
 * test exercises the fallback; this file stands the API up to pin the
 * native one: shown with its button as `source`, closed state handed
 * back when the browser light-dismisses it, focus returned to the
 * button when it was inside — and none of the hand-made dismissal.
 */

function Harness({ sticky = false }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  useAnchoredPopover({ open, onClose: () => setOpen(false), buttonRef, panelRef });
  const button = (
    <button ref={buttonRef} type="button" onClick={() => setOpen((o) => !o)}>
      Open
    </button>
  );
  return (
    <>
      {sticky ? <header style={{ position: "sticky", top: 0 }}>{button}</header> : button}
      {open && (
        <div ref={panelRef} data-testid="panel">
          <input aria-label="inside" autoFocus />
        </div>
      )}
      <p>outside</p>
    </>
  );
}

afterEach(() => {
  delete HTMLElement.prototype.showPopover;
  delete HTMLElement.prototype.hidePopover;
});

describe("useAnchoredPopover", () => {
  it("falls back to its own outside click and Escape without the API", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    fireEvent.keyUp(document, { key: "Escape" });
    expect(screen.queryByTestId("panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("shows a native popover from its button and follows the browser closing it", () => {
    const shown = [];
    HTMLElement.prototype.showPopover = vi.fn(function (options) {
      shown.push({ el: this, source: options?.source });
    });
    HTMLElement.prototype.hidePopover = vi.fn();
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Open" });
    fireEvent.click(button);
    const panel = screen.getByTestId("panel");
    expect(panel.getAttribute("popover")).toBe("auto");
    expect(shown).toEqual([{ el: panel, source: button }]);

    // The hand-made dismissal is off: the browser owns it.
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.getByTestId("panel")).toBeInTheDocument();

    // The browser light-dismisses it (Escape here): the focus that was
    // in the field goes back to the button.
    expect(document.activeElement).toBe(screen.getByLabelText("inside"));
    act(() => {
      const event = new Event("toggle");
      event.newState = "closed";
      panel.dispatchEvent(event);
    });
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe("useAnchoredPopover — a button that does not move with the page", () => {
  // The account button sits in the sticky header. Anchored to it, the
  // menu was moved by WebKit's scroll compensation as if the button had
  // scrolled away, then put back at the next layout.
  const supports = CSS.supports;
  afterEach(() => {
    CSS.supports = supports;
  });

  it("knows a button inside a sticky or fixed box", () => {
    render(
      <>
        <div style={{ position: "sticky", top: 0 }}>
          <span>
            <button type="button">In the header</button>
          </span>
        </div>
        <div style={{ position: "fixed" }}>
          <button type="button">In a bar</button>
        </div>
        <button type="button">On the page</button>
      </>,
    );
    expect(isPinned(screen.getByRole("button", { name: "In the header" }))).toBe(true);
    expect(isPinned(screen.getByRole("button", { name: "In a bar" }))).toBe(true);
    expect(isPinned(screen.getByRole("button", { name: "On the page" }))).toBe(false);
  });

  it("places the panel of a pinned button itself, even where anchors are supported", () => {
    CSS.supports = () => true;
    render(<Harness sticky />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const panel = screen.getByTestId("panel");
    expect(panel.style.getPropertyValue("position-anchor")).toBe("");
    expect(panel.style.top).toBe("8px");
    expect(panel.style.right).not.toBe("");
  });

  it("still anchors the panel of a button that scrolls with the page", () => {
    CSS.supports = () => true;
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("panel").style.getPropertyValue("position-anchor")).toMatch(/^--anchor-/);
  });
});

