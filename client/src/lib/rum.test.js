import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * 測 · What a field-measurement beacon may carry: a page without an id,
 * the metric, its phases, a selector — and nothing at all for a reader
 * who is not signed in.
 */
const callbacks = {};
vi.mock("web-vitals/attribution", () => ({
  onLCP: (cb) => (callbacks.LCP = cb),
  onINP: (cb) => (callbacks.INP = cb),
  onCLS: (cb) => (callbacks.CLS = cb),
  onFCP: (cb) => (callbacks.FCP = cb),
  onTTFB: (cb) => (callbacks.TTFB = cb),
}));
vi.mock("@/utils/auth.js", () => ({ getCachedUser: () => null }));

const { routeOf, summarise } = await import("./rum.js");

describe("routeOf", () => {
  it("names a page, never what is on it", () => {
    expect(routeOf("/stats")).toBe("/stats");
    expect(routeOf("/")).toBe("/");
    expect(routeOf("/author/1234")).toBe("/author/:param");
    expect(routeOf("/u/some-reader")).toBe("/u/:param");
    expect(routeOf("/year-in-review/2025/3")).toBe("/year-in-review/:param");
    expect(routeOf("/no-such-page")).toBe("/other");
    expect(routeOf("/author/")).toBe("/other");
    expect(routeOf(undefined)).toBe("/other");
  });
});

describe("summarise", () => {
  it("keeps the phases and the element of a slow paint", () => {
    const lcp = summarise(
      {
        name: "LCP",
        value: 2412.37,
        rating: "needs-improvement",
        navigationType: "navigate",
        attribution: { target: "header.washi-aged>span", timeToFirstByte: 80.04, resourceLoadDelay: 10, resourceLoadDuration: 0, elementRenderDelay: 2322.33 },
      },
      "/stats",
    );
    expect(lcp).toEqual({
      n: "LCP",
      v: 2412.4,
      r: "needs-improvement",
      nav: "navigate",
      route: "/stats",
      t: "header.washi-aged>span",
      d: [80, 10, 0, 2322.3],
    });
  });

  it("keeps how an interaction was slow, and CLS to three decimals", () => {
    const inp = summarise(
      { name: "INP", value: 312, rating: "poor", navigationType: "navigate", attribution: { interactionTarget: "button.emaki-hit", interactionType: "pointer", inputDelay: 12, processingDuration: 250, presentationDelay: 50 } },
      "/mangapage",
    );
    expect(inp).toMatchObject({ n: "INP", t: "button.emaki-hit", k: "pointer", d: [12, 250, 50], route: "/mangapage" });
    expect(summarise({ name: "CLS", value: 0.123456, rating: "needs-improvement", attribution: {} }, "/").v).toBe(0.123);
  });

  it("cuts a long selector", () => {
    const cls = summarise({ name: "CLS", value: 0.2, attribution: { largestShiftTarget: "div>".repeat(60) } }, "/");
    expect(cls.t.length).toBe(120);
  });
});

describe("startRum", () => {
  let beacons;
  beforeEach(() => {
    beacons = [];
    vi.stubGlobal("navigator", {
      ...navigator,
      sendBeacon: vi.fn((url, blob) => {
        beacons.push({ url, blob });
        return true;
      }),
    });
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  const hide = () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.visibilityState;
  };

  it("sends what was measured when the page is hidden, for a signed-in reader", async () => {
    const { startRum } = await import("./rum.js");
    startRum({ isSignedIn: () => true });
    callbacks.LCP({ name: "LCP", value: 1800, rating: "good", navigationType: "navigate", attribution: {} });
    callbacks.CLS({ name: "CLS", value: 0.01, rating: "good", navigationType: "navigate", attribution: {} });
    hide();
    expect(beacons).toHaveLength(1);
    expect(beacons[0].url).toBe("/api/rum");
    const sent = JSON.parse(await beacons[0].blob.text());
    expect(sent.metrics.map((m) => m.n)).toEqual(["LCP", "CLS"]);
    expect(sent).not.toHaveProperty("user");
    hide();
    expect(beacons).toHaveLength(1);
  });

  it("sends nothing for a reader who is not signed in", async () => {
    const { startRum } = await import("./rum.js");
    startRum({ isSignedIn: () => false });
    callbacks.FCP({ name: "FCP", value: 900, rating: "good", navigationType: "navigate", attribution: {} });
    hide();
    expect(beacons).toHaveLength(0);
  });

  it("sends a full queue at once, a dozen at most per beacon", async () => {
    const { startRum } = await import("./rum.js");
    startRum({ isSignedIn: () => true });
    for (let i = 0; i < 12; i++) {
      callbacks.INP({ name: "INP", value: 40 + i, rating: "good", navigationType: "navigate", attribution: {} });
    }
    expect(beacons).toHaveLength(1);
    expect(JSON.parse(await beacons[0].blob.text()).metrics).toHaveLength(12);
  });
});
