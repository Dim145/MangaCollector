import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * 通 · The HTTP client is `fetch` with axios's shape. These pin the shape
 * the rest of the app was written against: what a response looks like,
 * how a body goes out, what a failure carries, and the interceptor order.
 */
vi.mock("@/lib/db.js", () => ({ clearAllUserData: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/privateCaches.js", () => ({ purgePrivateCaches: vi.fn() }));
vi.mock("@/lib/clientId.js", () => ({ getClientId: () => "client-1" }));
vi.mock("./auth.js", () => ({ clearCachedUser: vi.fn() }));

const { default: http } = await import("./axios.js");

function reply(body, { status = 200, headers = { "Content-Type": "application/json" } } = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1);
  return { url: new URL(url), init };
};

describe("http (fetch with axios's shape)", () => {
  it("answers { data, status, headers } with parsed JSON and lower-case headers", async () => {
    fetchMock.mockResolvedValue(reply({ id: 7 }, { headers: { "Content-Type": "application/json", ETag: 'W/"abc"' } }));
    const res = await http.get("/api/user/library");
    expect(res.data).toEqual({ id: 7 });
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe('W/"abc"');
    expect(res.headers["content-type"]).toContain("application/json");
    const { url, init } = lastCall();
    expect(url.pathname).toBe("/api/user/library");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.headers["X-Client-Id"]).toBe("client-1");
  });

  it("sends an object as JSON and leaves FormData to the browser", async () => {
    fetchMock.mockImplementation(() => reply({ ok: true }));
    await http.post("/api/volume", { owned: true });
    let { init } = lastCall();
    expect(init.body).toBe('{"owned":true}');
    expect(init.headers["Content-Type"]).toBe("application/json");

    const form = new FormData();
    form.append("file", new Blob(["x"]), "x.jpg");
    await http.post("/api/user/storage/poster/1", form, { headers: { "Content-Type": "multipart/form-data" } });
    ({ init } = lastCall());
    expect(init.body).toBe(form);
    // The boundary is only right when the browser writes the header.
    expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain("content-type");
  });

  it("adds query parameters, skipping the empty ones, and passes caller headers", async () => {
    fetchMock.mockResolvedValue(reply([]));
    await http.get("/api/external/search", {
      params: { q: "one piece", page: 2, none: undefined, nil: null },
      headers: { "Idempotency-Key": "k1" },
    });
    const { url, init } = lastCall();
    expect(url.searchParams.get("q")).toBe("one piece");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("none")).toBe(false);
    expect(url.searchParams.has("nil")).toBe(false);
    expect(init.headers["Idempotency-Key"]).toBe("k1");
  });

  it("keeps a body that is not JSON as text, and honours transformResponse and blobs", async () => {
    fetchMock.mockResolvedValueOnce(reply("<html></html>", { headers: { "Content-Type": "text/html" } }));
    expect((await http.get("/somewhere")).data).toBe("<html></html>");

    fetchMock.mockResolvedValueOnce(reply('{"a":1}'));
    const raw = await http.get("/api/user/volume", { responseType: "text", transformResponse: [(body) => body] });
    expect(raw.data).toBe('{"a":1}');

    fetchMock.mockResolvedValueOnce(new Response(new Blob(["zip"]), { status: 200, headers: { "Content-Disposition": 'attachment; filename="a.zip"' } }));
    const file = await http.get("/api/archive/export", { responseType: "blob" });
    expect(file.data).toBeInstanceOf(Blob);
    expect(file.headers["content-disposition"]).toContain("a.zip");
  });

  it("rejects a status outside 2xx with the response, its parsed body and axios's code", async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: "Nope" }, { status: 422 }));
    const refused = await http.post("/api/import", {}).catch((e) => e);
    expect(refused.response.status).toBe(422);
    expect(refused.response.data.error).toBe("Nope");
    expect(refused.code).toBe("ERR_BAD_REQUEST");
    expect(refused.config.url).toBe("/api/import");

    fetchMock.mockResolvedValueOnce(reply({ error: "Upstream" }, { status: 502 }));
    expect((await http.get("/api/external/mal/1").catch((e) => e)).code).toBe("ERR_BAD_RESPONSE");
  });

  it("names a failure with no response, a timeout and a cancellation apart", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const down = await http.get("/api/health").catch((e) => e);
    expect(down.code).toBe("ERR_NETWORK");
    expect(down.response).toBeUndefined();

    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        (_url, { signal }) =>
          new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      );
      const pending = http.get("/auth/user", { timeout: 5000 }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(5001);
      const slow = await pending;
      expect(slow.code).toBe("ECONNABORTED");
    } finally {
      vi.useRealTimers();
    }

    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const stopped = await http.get("/api/user/isbn/1", { signal: controller.signal }).catch((e) => e);
    expect(stopped.code).toBe("ERR_CANCELED");
    expect(stopped.name).toBe("CanceledError");
  });

  it("runs response interceptors in order and stops running an ejected one", async () => {
    const seen = [];
    const a = http.interceptors.response.use((res) => (seen.push("a"), res));
    const b = http.interceptors.response.use((res) => (seen.push("b"), res));
    fetchMock.mockImplementation(() => reply({}));
    await http.get("/api/user/settings");
    expect(seen).toEqual(["a", "b"]);
    http.interceptors.response.eject(a);
    seen.length = 0;
    await http.get("/api/user/settings");
    expect(seen).toEqual(["b"]);
    http.interceptors.response.eject(b);
  });

  it("lets an error interceptor see the failure first, then the caller", async () => {
    const onError = vi.fn((err) => Promise.reject(err));
    const id = http.interceptors.response.use(undefined, onError);
    fetchMock.mockResolvedValue(reply({ error: "gone" }, { status: 404 }));
    const err = await http.delete("/api/user/locations/9").catch((e) => e);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].response.status).toBe(404);
    expect(err.response.status).toBe(404);
    expect(lastCall().init.method).toBe("DELETE");
    http.interceptors.response.eject(id);
  });

  it("keeps axios's baseURL for the pages that build an address from it", () => {
    expect(http.defaults.baseURL).toBe(window.location.origin);
  });
});
