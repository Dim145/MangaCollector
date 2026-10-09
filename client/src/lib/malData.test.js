import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/utils/axios.js", () => ({ default: { get: (...a) => get(...a) } }));

const { getMal, isMissing, MAL_UNAVAILABLE } = await import("./malData.js");

describe("malData", () => {
  beforeEach(() => get.mockReset());

  it("asks our own server, never an upstream directly", async () => {
    get.mockResolvedValue({ data: { recommendations: [] } });
    await getMal("13/recommendations");
    expect(get).toHaveBeenCalledWith("/api/external/mal/13/recommendations");
  });

  it("returns the body as the server sent it", async () => {
    get.mockResolvedValue({ data: { mal_id: 13, title: "One Piece" } });
    expect(await getMal("13")).toEqual({ mal_id: 13, title: "One Piece" });
  });

  // A 404 may be remembered as "nothing here"; an outage must not be,
  // or the empty answer would hide the real one for the cache's life.
  it("treats only a 404 as an answer", () => {
    expect(isMissing({ response: { status: 404 } })).toBe(true);
    for (const status of [429, 500, 502, 503]) {
      expect(isMissing({ response: { status } })).toBe(false);
    }
    expect(isMissing(new Error("Network Error"))).toBe(false);
    expect(isMissing(undefined)).toBe(false);
  });

  it("names the error state the screens share", () => {
    expect(MAL_UNAVAILABLE).toBe("mal-unavailable");
  });
});
