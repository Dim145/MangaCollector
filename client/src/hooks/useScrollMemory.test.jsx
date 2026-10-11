import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollMemory } from "./useScrollMemory.js";
import {
  _resetScrollMemory,
  noteRestoreLaidOut,
  restoringTo,
  writeScroll,
} from "@/lib/scrollMemory.js";

/*
 * 戻 · Coming back to the library from a series. What the reader saw
 * was the shelf's top for a frame, then a jump to where they had been:
 * the restore waited for a frame of its own, and the windowed grid had
 * laid out the rows of the offset the page was leaving. Now the shell
 * says where it is going while it renders, and puts the page there from
 * its layout effect — before anything is painted — when the page can
 * already hold it. (MemoryRouter's first entry is a POP arrival, keyed
 * "default", like a "back" to a remembered entry.)
 */

let frames;
let height;

beforeEach(() => {
  _resetScrollMemory();
  sessionStorage.clear();
  frames = [];
  // Frames run only when the test says so: anything placed before is
  // placed before the first paint.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  height = 20000;
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => height,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.scrollHeight;
});

function Page({ seen }) {
  // What a grid reads while rendering, under the shell.
  seen.push(restoringTo());
  useLocation();
  return null;
}

function Shell({ seen }) {
  useScrollMemory();
  return <Page seen={seen} />;
}

function GridShell({ Grid }) {
  useScrollMemory();
  return <Grid />;
}

const mount = (seen, path = "/dashboard") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Shell seen={seen} />
    </MemoryRouter>,
  );

describe("useScrollMemory — coming back to the library", () => {
  it("tells the page under it where it is going, while it renders", () => {
    writeScroll("default", 7208);
    const seen = [];
    mount(seen);
    expect(seen[0]).toBe(7208);
  });

  it("puts a page that can hold the position there before any frame", () => {
    writeScroll("default", 7208);
    mount([]);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 7208, left: 0, behavior: "instant" });
    // Placed: a grid created from now on reads the real offset.
    expect(restoringTo()).toBeNull();
  });

  it("waits for a page still too short, and keeps the target announced meanwhile", () => {
    writeScroll("default", 7208);
    height = 1200;
    mount([]);
    expect(window.scrollTo).not.toHaveBeenCalledWith(expect.objectContaining({ top: 7208 }));
    expect(restoringTo()).toBe(7208);

    // The shelf arrives; the next frame puts the page back.
    height = 20000;
    frames.shift()(performance.now());
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 7208, left: 0, behavior: "instant" });
    expect(restoringTo()).toBeNull();
  });

  it("does not wait for a page a grid has already laid out for the target", () => {
    // The shelf got shorter since: the grid knows its height, so the
    // page goes as far as it can now instead of showing an empty band
    // for a second and a half.
    writeScroll("default", 7208);
    height = 3000;
    function Grid() {
      if (restoringTo() != null) noteRestoreLaidOut();
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <GridShell Grid={Grid} />
      </MemoryRouter>,
    );
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 3000 - window.innerHeight, left: 0, behavior: "instant" });
    expect(restoringTo()).toBeNull();
  });

  it("announces nothing for a page that does not remember its position", () => {
    writeScroll("default", 7208);
    const seen = [];
    mount(seen, "/mangapage");
    expect(seen[0]).toBeNull();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
  });
});
