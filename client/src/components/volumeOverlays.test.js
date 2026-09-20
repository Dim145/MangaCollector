import { act, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetVolumeOverlays,
  preloadVolumeOverlays,
  volumeOverlays,
  volumeOverlaysReady,
} from "./volumeOverlays.js";
import { useVolumeOverlays } from "@/hooks/useVolumeOverlays.js";

/*
 * 扉 · What this pins is the reason the module exists: the overlays are
 * fetched off the critical path, and once fetched they are available
 * **synchronously**, with no suspension between a reader's tap and the
 * drawer. Measured on the series page, going through `React.lazy`
 * instead cost 302 ms on the first tap against 3 ms this way.
 */

const Drawer = () => null;
const Sheet = () => null;
let drawerImports = 0;

vi.mock("./VolumeDetailDrawer.jsx", () => {
  drawerImports += 1;
  return { default: Drawer };
});
vi.mock("./LoanModal.jsx", () => ({ default: Sheet }));

afterEach(() => {
  _resetVolumeOverlays();
});

describe("volumeOverlays", () => {
  it("holds nothing until asked, then both", async () => {
    expect(volumeOverlaysReady()).toBe(false);
    expect(volumeOverlays()).toEqual({
      VolumeDetailDrawer: null,
      LoanModal: null,
    });

    await preloadVolumeOverlays();

    expect(volumeOverlaysReady()).toBe(true);
    expect(volumeOverlays()).toEqual({
      VolumeDetailDrawer: Drawer,
      LoanModal: Sheet,
    });
  });

  it("imports once however many cards ask", async () => {
    const before = drawerImports;
    const a = preloadVolumeOverlays();
    const b = preloadVolumeOverlays();
    expect(a).toBe(b);
    await Promise.all([a, b, preloadVolumeOverlays()]);
    expect(drawerImports - before).toBeLessThanOrEqual(1);
  });
});

function Probe({ needed, seen }) {
  seen.push(useVolumeOverlays(needed));
  return null;
}

describe("useVolumeOverlays", () => {
  it("gives a card nothing until it needs them", async () => {
    const seen = [];
    render(createElement(Probe, { needed: false, seen }));
    expect(seen.at(-1)).toBeNull();
    // Nothing was fetched on a card nobody touched.
    expect(volumeOverlaysReady()).toBe(false);
  });

  it("fetches on first need and then hands them over", async () => {
    const seen = [];
    render(createElement(Probe, { needed: true, seen }));
    expect(seen[0]).toBeNull();
    await act(async () => {
      await preloadVolumeOverlays();
    });
    expect(seen.at(-1)).toEqual({
      VolumeDetailDrawer: Drawer,
      LoanModal: Sheet,
    });
  });

  it("is ready on the first render of a card mounted after the preload", async () => {
    // The real case: MangaPage warmed them while the page was idle, so
    // the very first render of the card that a reader taps already has
    // them — no second render, no gap.
    await preloadVolumeOverlays();
    const seen = [];
    render(createElement(Probe, { needed: true, seen }));
    expect(seen[0]).toEqual({
      VolumeDetailDrawer: Drawer,
      LoanModal: Sheet,
    });
  });
});
