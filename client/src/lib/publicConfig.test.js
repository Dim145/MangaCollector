import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicConfig } from "./publicConfig.js";

/*
 * 設 · The SPA sees of `/api/public-config` only what `normalize` carries.
 * A switch the server announces and this drops is a switch that is off
 * without anyone saying so — it happened to the cover relay, then to the
 * field measurements.
 */
afterEach(() => vi.unstubAllGlobals());

function serve(body, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));
}

describe("fetchPublicConfig", () => {
  it("carries every switch the server announces", async () => {
    serve({ errorTracking: null, proxyCovers: true, rum: true });
    expect(await fetchPublicConfig()).toEqual({ errorTracking: null, proxyCovers: true, rum: true });
  });

  it("reads anything but a plain true as off", async () => {
    serve({ proxyCovers: "true", rum: 1 });
    expect(await fetchPublicConfig()).toEqual({ errorTracking: null, proxyCovers: false, rum: false });
  });

  it("keeps error tracking only with a DSN", async () => {
    serve({ errorTracking: { provider: "sentry" }, rum: false });
    expect((await fetchPublicConfig()).errorTracking).toBeNull();
  });

  it("answers null when the server does not", async () => {
    serve({}, false);
    expect(await fetchPublicConfig()).toBeNull();
  });
});
