import { act, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetRowHeightMemory,
  instantWindowScroll,
  laneCountForWidth,
  rowsForItems,
  useWindowGridVirtualizer,
} from "./useWindowGridVirtualizer.js";

const LANES = [
  { min: 1024, lanes: 3 },
  { min: 640, lanes: 2 },
  { min: 0, lanes: 1 },
];

describe("laneCountForWidth", () => {
  it.each([
    [320, 1],
    [639, 1],
    [640, 2],
    [1023, 2],
    [1024, 3],
    [2560, 3],
  ])("maps a %ipx viewport to %i lanes", (w, lanes) => {
    expect(laneCountForWidth(w, LANES)).toBe(lanes);
  });

  it("falls back to the narrowest breakpoint for an impossible width", () => {
    expect(laneCountForWidth(-1, LANES)).toBe(1);
  });
});

describe("rowsForItems", () => {
  it("returns no rows when nothing is pinned", () => {
    expect(rowsForItems(undefined, 3, 10)).toEqual([]);
    expect(rowsForItems([], 3, 10)).toEqual([]);
  });

  it("maps item indexes to their row for the given lane count", () => {
    // 3 lanes: items 0-2 → row 0, 3-5 → row 1, …
    expect(rowsForItems([4], 3, 10)).toEqual([1]);
    expect(rowsForItems([0, 2], 3, 10)).toEqual([0]);
    expect(rowsForItems([9], 3, 10)).toEqual([3]);
  });

  it("dedupes and sorts", () => {
    expect(rowsForItems([7, 1, 8, 0], 3, 10)).toEqual([0, 2]);
  });

  it("re-maps when the lane count changes", () => {
    // The same busy tile lands in a different row on a narrower screen.
    expect(rowsForItems([5], 3, 10)).toEqual([1]);
    expect(rowsForItems([5], 1, 10)).toEqual([5]);
  });

  it("drops rows beyond the grid and junk indexes", () => {
    expect(rowsForItems([30, -1, 2.5, NaN, 1], 3, 4)).toEqual([0]);
  });
});

/*
 * 寸 · The row height: learnt from the first row measured, applied to
 * every row not yet measured, remembered for the grid's next mount.
 * This is what lets a scroll restore land in the grid's tail at once —
 * with a guess 34 px short per row, the document could not hold a
 * position in the last rows until they were rendered, and they were not
 * rendered until the position was reached. jsdom has no layout, so a
 * row here is a bare element whose `offsetHeight` — what TanStack
 * measures — the test dictates.
 */
const SIX = [{ min: 0, lanes: 6 }];
const THREE = [{ min: 0, lanes: 3 }];

function Probe({ onHook, ...opts }) {
  const hook = useWindowGridVirtualizer(opts);
  onHook(hook);
  return createElement("div", {
    ref: hook.parentRef,
    style: { height: hook.virtualizer.getTotalSize() },
  });
}

function mount(opts) {
  let hook;
  const utils = render(
    createElement(Probe, {
      ...opts,
      onHook: (h) => {
        hook = h;
      },
    }),
  );
  return {
    get hook() {
      return hook;
    },
    unmount: utils.unmount,
  };
}

function rowNode(index, height) {
  const node = document.createElement("div");
  node.setAttribute("data-index", String(index));
  Object.defineProperty(node, "offsetHeight", { value: height });
  // In the document, as a rendered row is: TanStack Virtual (3.14+) only
  // records the size of a node that is connected.
  document.body.appendChild(node);
  return node;
}

describe("row height", () => {
  beforeAll(() => {
    if (typeof ResizeObserver === "undefined") {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
    // jsdom logs "not implemented" for the window scroll TanStack issues.
    window.scrollTo = vi.fn();
  });
  beforeEach(() => _resetRowHeightMemory());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const library = { itemCount: 132, laneBreakpoints: SIX, estimateSize: 270 };

  it("takes the first measured row as the height of every row", () => {
    // 132 series in 6 lanes → 22 rows, guessed at 270 px each.
    const m = mount({ ...library, memoryKey: "t:library" });
    expect(m.hook.virtualizer.getTotalSize()).toBe(22 * 270);
    act(() => m.hook.measureRow(rowNode(0, 304)));
    expect(m.hook.virtualizer.getTotalSize()).toBe(22 * 304);
  });

  it("remembers it for the next mount of the same grid, lanes and width", () => {
    const first = mount({ ...library, memoryKey: "t:library" });
    act(() => first.hook.measureRow(rowNode(0, 304)));
    first.unmount();
    const again = mount({ ...library, memoryKey: "t:library" });
    expect(again.hook.virtualizer.getTotalSize()).toBe(22 * 304);
    // Another grid, or the same one with another lane count, knows nothing.
    const other = mount({ ...library, memoryKey: "t:volumes" });
    expect(other.hook.virtualizer.getTotalSize()).toBe(22 * 270);
    const narrow = mount({
      ...library,
      laneBreakpoints: THREE,
      memoryKey: "t:library",
    });
    expect(narrow.hook.virtualizer.getTotalSize()).toBe(44 * 270);
  });

  it("keeps a height learnt without a key to the mount that learnt it", () => {
    const first = mount(library);
    act(() => first.hook.measureRow(rowNode(0, 304)));
    expect(first.hook.virtualizer.getTotalSize()).toBe(22 * 304);
    first.unmount();
    expect(mount(library).hook.virtualizer.getTotalSize()).toBe(22 * 270);
  });

  it("learns nothing from a row without a height, and survives an unmount", () => {
    const m = mount({ ...library, memoryKey: "t:library" });
    act(() => m.hook.measureRow(rowNode(0, 0)));
    // TanStack records the zero for that one row, as it always did; the
    // other rows keep the guess, and so does the next mount.
    expect(m.hook.virtualizer.getTotalSize()).toBe(21 * 270);
    expect(() => act(() => m.hook.measureRow(null))).not.toThrow();
    m.unmount();
    expect(
      mount({ ...library, memoryKey: "t:library" }).hook.virtualizer.getTotalSize(),
    ).toBe(22 * 270);
  });
});

describe("instantWindowScroll", () => {
  const instance = (horizontal = false) => ({
    scrollElement: { scrollTo: vi.fn() },
    options: { horizontal },
  });

  it("makes a correction — no behaviour given — instant, whatever the stylesheet says", () => {
    const inst = instance();
    instantWindowScroll(6499, { adjustments: 34 }, inst);
    expect(inst.scrollElement.scrollTo).toHaveBeenCalledWith({
      top: 6533,
      behavior: "instant",
    });
  });

  it("keeps a behaviour that was asked for", () => {
    const inst = instance();
    instantWindowScroll(100, { behavior: "smooth" }, inst);
    expect(inst.scrollElement.scrollTo).toHaveBeenCalledWith({
      top: 100,
      behavior: "smooth",
    });
    instantWindowScroll(100, { behavior: "auto" }, inst);
    expect(inst.scrollElement.scrollTo).toHaveBeenLastCalledWith({
      top: 100,
      behavior: "auto",
    });
  });

  it("scrolls the other axis for a horizontal virtualizer and survives a missing window", () => {
    const inst = instance(true);
    instantWindowScroll(40, {}, inst);
    expect(inst.scrollElement.scrollTo).toHaveBeenCalledWith({
      left: 40,
      behavior: "instant",
    });
    expect(() =>
      instantWindowScroll(0, {}, { scrollElement: null, options: {} }),
    ).not.toThrow();
  });
});
