import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemePreference,
  bootstrapThemeFromStorage,
  rememberThemePreference,
} from "./theme.js";

/*
 * The theme module's whole job is side effects on <html> and on the
 * `theme-color` meta tag, plus the media-query listener that makes
 * 'auto' track the OS live. jsdom ships no matchMedia, so the suite
 * installs a controllable fake and drives it.
 */

const DARK_META = "#161012";
const LIGHT_META = "#f3efe6";

let mql;

/** Minimal MediaQueryList fake with both the modern and Safari<14 APIs. */
function installMatchMedia(matches = false) {
  const listeners = new Set();
  const legacy = new Set();
  mql = {
    matches,
    media: "(prefers-color-scheme: light)",
    addEventListener: vi.fn((_, fn) => listeners.add(fn)),
    removeEventListener: vi.fn((_, fn) => listeners.delete(fn)),
    addListener: vi.fn((fn) => legacy.add(fn)),
    removeListener: vi.fn((fn) => legacy.delete(fn)),
    /** Simulate the OS flipping its colour scheme. */
    emit(next) {
      mql.matches = next;
      for (const fn of [...listeners, ...legacy]) fn({ matches: next });
    },
    listenerCount: () => listeners.size + legacy.size,
  };
  window.matchMedia = vi.fn(() => mql);
  return mql;
}

const root = () => document.documentElement;
const metaContent = () =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute("content");

beforeEach(() => {
  installMatchMedia(false);
  root().removeAttribute("data-theme");
  root().style.colorScheme = "";
  document.querySelector('meta[name="theme-color"]')?.remove();
});

afterEach(() => {
  // Leave no live OS listener behind for the next file.
  applyThemePreference("dark");
});

describe("applyThemePreference", () => {
  it("unsets data-theme for dark, the palette baked into :root", () => {
    applyThemePreference("dark");
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("sets data-theme=light for light", () => {
    applyThemePreference("light");
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it.each([["dark", DARK_META], ["light", LIGHT_META]])(
    "sets the %s theme-color meta to %s",
    (pref, expected) => {
      applyThemePreference(pref);
      expect(metaContent()).toBe(expected);
    },
  );

  it("creates the theme-color meta when the document has none", () => {
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
    applyThemePreference("light");
    expect(document.querySelector('meta[name="theme-color"]')).not.toBeNull();
  });

  it("reuses the existing meta rather than appending a second one", () => {
    applyThemePreference("light");
    applyThemePreference("dark");
    applyThemePreference("light");
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });

  it("hints the UA colour-scheme so native controls match", () => {
    applyThemePreference("light");
    expect(root().style.colorScheme).toBe("light");
    applyThemePreference("dark");
    expect(root().style.colorScheme).toBe("dark");
  });

  it.each([[undefined], [null], [""], ["sepia"], [42]])(
    "falls back to dark for the invalid preference %p",
    (pref) => {
      applyThemePreference("light");
      applyThemePreference(pref);
      expect(root().hasAttribute("data-theme")).toBe(false);
      expect(metaContent()).toBe(DARK_META);
    },
  );

  it("toggles cleanly back and forth", () => {
    applyThemePreference("light");
    applyThemePreference("dark");
    expect(root().hasAttribute("data-theme")).toBe(false);
    applyThemePreference("light");
    expect(root().getAttribute("data-theme")).toBe("light");
  });
});

describe("auto mode", () => {
  it("resolves to light when the OS prefers light", () => {
    installMatchMedia(true);
    applyThemePreference("auto");
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("resolves to dark when the OS prefers dark", () => {
    installMatchMedia(false);
    applyThemePreference("auto");
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("tracks a live OS change", () => {
    installMatchMedia(false);
    applyThemePreference("auto");
    mql.emit(true);
    expect(root().getAttribute("data-theme")).toBe("light");
    mql.emit(false);
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("registers through both the modern and the Safari<14 API", () => {
    installMatchMedia(false);
    applyThemePreference("auto");
    expect(mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(mql.addListener).toHaveBeenCalled();
  });

  it("detaches the listener when leaving auto", () => {
    installMatchMedia(false);
    applyThemePreference("auto");
    expect(mql.listenerCount()).toBeGreaterThan(0);
    applyThemePreference("dark");
    expect(mql.listenerCount()).toBe(0);
  });

  it("stops tracking the OS once a fixed preference is chosen", () => {
    installMatchMedia(false);
    applyThemePreference("auto");
    applyThemePreference("dark");
    mql.emit(true);
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("does not stack listeners when auto is applied repeatedly", () => {
    installMatchMedia(false);
    applyThemePreference("auto");
    applyThemePreference("auto");
    applyThemePreference("auto");
    // Each re-apply builds a fresh MediaQueryList, so the meaningful
    // assertion is that the previous one was detached, not the count
    // on the current object.
    expect(mql.listenerCount()).toBe(2); // modern + legacy, one pass
  });
});

describe("storage", () => {
  it("round-trips a preference", () => {
    rememberThemePreference("light");
    expect(localStorage.getItem("mc:theme")).toBe("light");
  });

  it("applies the stored preference on cold start", () => {
    rememberThemePreference("light");
    bootstrapThemeFromStorage();
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("does nothing when no preference was stored", () => {
    bootstrapThemeFromStorage();
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
  });

  it("falls back to dark for a stored value that is no longer valid", () => {
    localStorage.setItem("mc:theme", "solarized");
    bootstrapThemeFromStorage();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("does not throw when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => bootstrapThemeFromStorage()).not.toThrow();
    expect(() => rememberThemePreference("light")).not.toThrow();
  });
});
