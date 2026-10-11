import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, springEasing } from "./motion.js";

describe("springEasing", () => {
  const values = (easing) =>
    easing
      .slice("linear(".length, -1)
      .split(", ")
      .map((stop) => Number(stop.split(" ")[0]));

  it("starts at rest, ends at rest, and is a valid linear() list", () => {
    const easing = springEasing();
    expect(easing).toMatch(/^linear\(0 0%, .* 1 100%\)$/);
    const v = values(easing);
    expect(v[0]).toBe(0);
    expect(v.at(-1)).toBe(1);
  });

  it("overshoots barely at damping 0.9 — a spring, not a bounce", () => {
    const peak = Math.max(...values(springEasing({ zeta: 0.9 })));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.01);
  });

  it("overshoots more as damping falls, never at critical damping", () => {
    const peak = (zeta) => Math.max(...values(springEasing({ zeta })));
    expect(peak(0.5)).toBeGreaterThan(peak(0.9));
    expect(peak(1)).toBeLessThanOrEqual(1);
  });
});

describe("prefersReducedMotion", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it("reads the media query", () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
    window.matchMedia = vi.fn(() => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });
});
