import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./axios", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const axios = (await import("./axios")).default;
const {
  addCustomEntryToUserLibrary,
  addFromMangadexToUserLibrary,
  addToUserLibrary,
  refreshFromMangadex,
  refreshUpcoming,
  removePoster,
  uploadPoster,
} = await import("./user.js");

/*
 * Thin HTTP wrappers. What is worth pinning is the wire contract each
 * one commits to — path shape, verb, and how the response is unwrapped
 * — since every caller depends on those and nothing else guards them.
 */

beforeEach(() => {
  vi.clearAllMocks();
});

describe("addToUserLibrary", () => {
  it("POSTs the payload to the library collection", async () => {
    const payload = { mal_id: 2, name: "Berserk" };
    await addToUserLibrary(payload);
    expect(axios.post).toHaveBeenCalledWith("/api/user/library", payload);
  });

  it("resolves to undefined — the caller refetches rather than reading a body", async () => {
    await expect(addToUserLibrary({})).resolves.toBeUndefined();
  });
});

describe("uploadPoster", () => {
  it("posts multipart form data under the poster field", async () => {
    const blob = new Blob(["x"], { type: "image/png" });
    await uploadPoster(42, blob);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe("/api/user/storage/poster/42");
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("poster")).toBeInstanceOf(Blob);
  });

  it("keeps a negative custom-series id intact in the path", async () => {
    await uploadPoster(-7, new Blob(["x"]));
    expect(axios.post.mock.calls[0][0]).toBe("/api/user/storage/poster/-7");
  });
});

describe("removePoster", () => {
  it("DELETEs and returns the restored MAL poster url", async () => {
    axios.delete.mockResolvedValueOnce({ data: { malPoster: "https://cdn/x.jpg" } });
    await expect(removePoster(42)).resolves.toBe("https://cdn/x.jpg");
    expect(axios.delete).toHaveBeenCalledWith("/api/user/storage/poster/42");
  });

  it("returns undefined when the response carries no malPoster", async () => {
    axios.delete.mockResolvedValueOnce({ data: {} });
    await expect(removePoster(42)).resolves.toBeUndefined();
  });

  it("returns undefined rather than throwing on an empty body", async () => {
    axios.delete.mockResolvedValueOnce({ data: null });
    await expect(removePoster(42)).resolves.toBeUndefined();
  });
});

describe("addCustomEntryToUserLibrary", () => {
  it("POSTs to the custom endpoint and unwraps the created entry", async () => {
    axios.post.mockResolvedValueOnce({ data: { mal_id: -1 } });
    await expect(addCustomEntryToUserLibrary({ name: "Doujin" })).resolves.toEqual({
      mal_id: -1,
    });
    expect(axios.post).toHaveBeenCalledWith("/api/user/library/custom", {
      name: "Doujin",
    });
  });
});

describe("addFromMangadexToUserLibrary", () => {
  it("POSTs to the mangadex endpoint and unwraps the entry", async () => {
    axios.post.mockResolvedValueOnce({ data: { mal_id: 5 } });
    await expect(addFromMangadexToUserLibrary({ mangadex_id: "u" })).resolves.toEqual({
      mal_id: 5,
    });
    expect(axios.post).toHaveBeenCalledWith("/api/user/library/mangadex", {
      mangadex_id: "u",
    });
  });
});

describe("refreshFromMangadex", () => {
  it("GETs the per-series refresh endpoint", async () => {
    axios.get.mockResolvedValueOnce({ data: { updated: true } });
    await expect(refreshFromMangadex(2)).resolves.toEqual({ updated: true });
    expect(axios.get).toHaveBeenCalledWith("/api/user/library/2/refresh-from-mangadex");
  });
});

describe("refreshUpcoming", () => {
  it("POSTs — the sweep mutates server state", async () => {
    axios.post.mockResolvedValueOnce({ data: { success: true, added: [] } });
    await refreshUpcoming(2);
    expect(axios.post).toHaveBeenCalledWith("/api/user/library/2/refresh-upcoming");
  });

  it("sends no request body — the id in the path is the whole input", async () => {
    await refreshUpcoming(2);
    expect(axios.post.mock.calls[0]).toHaveLength(1);
  });

  it("unwraps the discovery report", async () => {
    const report = { success: true, added: [3, 4], updated: [], skipped: 1, discovered_count: 3 };
    axios.post.mockResolvedValueOnce({ data: report });
    await expect(refreshUpcoming(2)).resolves.toEqual(report);
  });

  it("keeps a negative custom-series id intact", async () => {
    await refreshUpcoming(-3);
    expect(axios.post).toHaveBeenCalledWith("/api/user/library/-3/refresh-upcoming");
  });
});
