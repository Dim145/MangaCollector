import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusTrap } from "./useFocusTrap.js";

/*
 * 留 · The first focus lands without scrolling. The container is still
 * arriving when it is given — the volume drawer translated by its own
 * width — and a focus that scrolls reveals it by moving whatever can
 * scroll around it, which the entrance animation then overshoots.
 */

let frames;
beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function Panel({ autofocus = false }) {
  const ref = useRef(null);
  useFocusTrap(true, ref, () => {});
  return (
    <div ref={ref} tabIndex={-1}>
      <button type="button">Close</button>
      {autofocus && <input data-autofocus aria-label="Price" />}
    </div>
  );
}

describe("useFocusTrap — the first focus", () => {
  it("goes to the panel without scrolling anything", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<Panel />);
    frames.shift()();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("goes to the field marked to receive it, without scrolling either", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const { getByLabelText } = render(<Panel autofocus />);
    frames.shift()();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(getByLabelText("Price"));
  });
});
