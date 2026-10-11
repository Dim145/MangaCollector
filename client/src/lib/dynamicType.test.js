import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDynamicType, systemTextScale } from "./dynamicType.js";

/*
 * The root follows iOS's text size where the keyword exists and the
 * pointer is a finger — grown, never shrunk below the design, at most
 * twice — and is left alone everywhere else.
 */

let bodyPx;
const originalSupports = globalThis.CSS?.supports;
const originalMatchMedia = window.matchMedia;
const originalGetComputedStyle = window.getComputedStyle;

function environment({ supports = true, coarse = true, px = 17 } = {}) {
  bodyPx = px;
  globalThis.CSS = { ...(globalThis.CSS ?? {}), supports: vi.fn(() => supports) };
  window.matchMedia = vi.fn((q) => ({ matches: q === "(pointer: coarse)" ? coarse : false }));
  window.getComputedStyle = vi.fn((el) =>
    el.style.font === "-apple-system-body" || el.textContent === "字"
      ? { fontSize: `${bodyPx}px` }
      : originalGetComputedStyle(el),
  );
}

beforeEach(() => {
  document.documentElement.style.removeProperty("font-size");
});

afterEach(() => {
  if (originalSupports) globalThis.CSS.supports = originalSupports;
  window.matchMedia = originalMatchMedia;
  window.getComputedStyle = originalGetComputedStyle;
});

describe("systemTextScale", () => {
  it("is 1 at iOS's default size", () => {
    environment({ px: 17 });
    expect(systemTextScale()).toBe(1);
  });

  it("follows a larger setting", () => {
    environment({ px: 23 });
    expect(systemTextScale()).toBeCloseTo(23 / 17, 5);
  });

  it("stops at twice the default", () => {
    environment({ px: 53 });
    expect(systemTextScale()).toBe(2);
  });

  it("never shrinks the design for a smaller setting", () => {
    environment({ px: 14 });
    expect(systemTextScale()).toBe(1);
  });

  it("ignores the keyword with a mouse — macOS answers a fixed 13 px", () => {
    environment({ coarse: false, px: 13 });
    expect(systemTextScale()).toBe(1);
  });

  it("does nothing where the keyword does not exist", () => {
    environment({ supports: false, px: 30 });
    expect(systemTextScale()).toBe(1);
  });
});

describe("applyDynamicType", () => {
  it("sizes the root, and gives it back when the setting returns to default", () => {
    environment({ px: 21 });
    expect(applyDynamicType()).toBeCloseTo(21 / 17, 5);
    expect(document.documentElement.style.fontSize).toBe("19.76px");
    bodyPx = 17;
    applyDynamicType();
    expect(document.documentElement.style.fontSize).toBe("");
  });
});
