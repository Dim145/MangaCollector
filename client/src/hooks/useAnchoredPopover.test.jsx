import { useRef, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAnchoredPopover } from "./useAnchoredPopover.js";

/*
 * The hook has two paths. jsdom has no popover API, so every component
 * test exercises the fallback; this file stands the API up to pin the
 * native one: shown with its button as `source`, closed state handed
 * back when the browser light-dismisses it, focus returned to the
 * button when it was inside — and none of the hand-made dismissal.
 */

function Harness() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  useAnchoredPopover({ open, onClose: () => setOpen(false), buttonRef, panelRef });
  return (
    <>
      <button ref={buttonRef} type="button" onClick={() => setOpen((o) => !o)}>
        Open
      </button>
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
