import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/axios.js", () => ({
  default: { get: vi.fn(), interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } } },
}));

const axios = (await import("@/utils/axios.js")).default;
const {
  getServerReachable,
  isFullyOnline,
  onConnectivityChange,
  probeServer,
} = await import("./connectivity.js");

/*
 * "Online" here means two things at once: the browser says it has a
 * network AND our backend actually answered. The distinction matters
 * on a captive portal and behind the SPA fallback, where a request for
 * an API route comes back 200 with an HTML body — the case the
 * content-type check exists to catch, and the one that would otherwise
 * let the outbox flush into a void.
 */

const JSON_HEADERS = { "content-type": "application/json" };
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

function setOnLine(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

/** Drive the module back to a known-reachable state between cases. */
async function resetToReachable() {
  setOnLine(true);
  axios.get.mockResolvedValueOnce({ status: 200, headers: JSON_HEADERS, data: {} });
  await probeServer();
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetToReachable();
  vi.clearAllMocks();
});

afterEach(() => {
  setOnLine(true);
});

describe("isFullyOnline", () => {
  it("is true when the browser is online and the server answered", async () => {
    expect(isFullyOnline()).toBe(true);
  });

  it("is false when the browser reports offline, whatever the server said", () => {
    setOnLine(false);
    expect(isFullyOnline()).toBe(false);
  });

  it("is false when the browser is online but the server is unreachable", async () => {
    axios.get.mockRejectedValueOnce(new Error("Network Error"));
    await probeServer();
    expect(isFullyOnline()).toBe(false);
    expect(navigator.onLine).toBe(true);
  });
});

describe("probeServer", () => {
  it("reports reachable on a JSON 200", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, headers: JSON_HEADERS, data: {} });
    await expect(probeServer()).resolves.toBe(true);
    expect(getServerReachable()).toBe(true);
  });

  it("probes the provider endpoint with a timeout", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, headers: JSON_HEADERS, data: {} });
    await probeServer();
    expect(axios.get).toHaveBeenCalledWith("/auth/provider", { timeout: 5000 });
  });

  it("treats an HTML 200 as unreachable — that is the SPA fallback", async () => {
    // nginx serving index.html for an API path means the backend is
    // down; a naive status check would call this healthy and let the
    // outbox flush into a void.
    axios.get.mockResolvedValueOnce({ status: 200, headers: HTML_HEADERS, data: "<!doctype html>" });
    await expect(probeServer()).resolves.toBe(false);
    expect(getServerReachable()).toBe(false);
  });

  it("accepts problem+json as a backend response", async () => {
    axios.get.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/problem+json" },
      data: {},
    });
    await expect(probeServer()).resolves.toBe(true);
  });

  it("tolerates a mixed-case content-type header from a dev proxy", async () => {
    axios.get.mockResolvedValueOnce({
      status: 200,
      headers: { "Content-Type": "application/json" },
      data: {},
    });
    await expect(probeServer()).resolves.toBe(true);
  });

  it("treats a missing content-type as unreachable", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, headers: {}, data: {} });
    await expect(probeServer()).resolves.toBe(false);
  });

  it.each([400, 401, 404, 429])(
    "treats a JSON %i as reachable — the server answered, it just refused",
    async (status) => {
      axios.get.mockRejectedValueOnce({
        response: { status, headers: JSON_HEADERS, data: {} },
      });
      await expect(probeServer()).resolves.toBe(true);
      expect(getServerReachable()).toBe(true);
    },
  );

  it.each([500, 502, 503, 504])("treats a %i as unreachable", async (status) => {
    axios.get.mockRejectedValueOnce({
      response: { status, headers: JSON_HEADERS, data: {} },
    });
    await expect(probeServer()).resolves.toBe(false);
  });

  it("treats a 4xx served as HTML as unreachable", async () => {
    axios.get.mockRejectedValueOnce({
      response: { status: 404, headers: HTML_HEADERS, data: "<!doctype html>" },
    });
    await expect(probeServer()).resolves.toBe(false);
  });

  it("treats a transport failure as unreachable", async () => {
    axios.get.mockRejectedValueOnce(new Error("Network Error"));
    await expect(probeServer()).resolves.toBe(false);
  });

  it("short-circuits without a request when the browser is offline", async () => {
    setOnLine(false);
    await expect(probeServer()).resolves.toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("coalesces concurrent probes into a single request", async () => {
    let resolve;
    axios.get.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const a = probeServer();
    const b = probeServer();
    expect(a).toBe(b);
    resolve({ status: 200, headers: JSON_HEADERS, data: {} });
    await a;
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh probe once the in-flight one settles", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, headers: JSON_HEADERS, data: {} });
    await probeServer();
    axios.get.mockResolvedValueOnce({ status: 200, headers: JSON_HEADERS, data: {} });
    await probeServer();
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});

describe("change notifications", () => {
  const subs = [];
  const sub = (fn) => { const off = onConnectivityChange(fn); subs.push(off); return off; };
  afterEach(() => { while (subs.length) subs.pop()(); });

  it("fires when reachability flips", async () => {
    const handler = vi.fn();
    sub(handler);
    axios.get.mockRejectedValueOnce(new Error("Network Error"));
    await probeServer();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ serverReachable: false });
  });

  it("stays quiet when the state does not change", async () => {
    const handler = vi.fn();
    sub(handler);
    axios.get.mockResolvedValueOnce({ status: 200, headers: JSON_HEADERS, data: {} });
    await probeServer();
    expect(handler).not.toHaveBeenCalled();
  });

  it("fires once per transition, not once per probe", async () => {
    const handler = vi.fn();
    sub(handler);
    for (let i = 0; i < 3; i++) {
      axios.get.mockRejectedValueOnce(new Error("Network Error"));
      await probeServer();
    }
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fires again on recovery", async () => {
    const handler = vi.fn();
    sub(handler);
    axios.get.mockRejectedValueOnce(new Error("Network Error"));
    await probeServer();
    axios.get.mockResolvedValueOnce({ status: 200, headers: JSON_HEADERS, data: {} });
    await probeServer();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1][0].detail).toEqual({ serverReachable: true });
  });

  it("stops delivering after unsubscribe", async () => {
    const handler = vi.fn();
    sub(handler)();
    axios.get.mockRejectedValueOnce(new Error("Network Error"));
    await probeServer();
    expect(handler).not.toHaveBeenCalled();
  });
});
