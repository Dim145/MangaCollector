import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/axios.js", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const axios = (await import("@/utils/axios.js")).default;
const {
  filterAdultGenreIfNeeded,
  hasToBlurImage,
  updateLibFromMal,
  updateVolumeOwned,
} = await import("./library.js");

/*
 * Adult-content gating. `adult_content_level` is a tri-state user
 * setting:
 *   0 — default: adult series are listed but their covers are blurred
 *   1 — hide: adult series are filtered out of the list entirely
 *   2 — show: no blurring, no filtering
 * Getting the levels backwards would either leak explicit covers to a
 * user who asked not to see them, or hide series from one who did.
 */

const ADULT = ["Hentai", "Erotica", "Adult"];

describe("hasToBlurImage", () => {
  it.each([[0], [1]])("blurs an adult series at level %i", (level) => {
    expect(hasToBlurImage({ genres: ["Hentai"] }, level)).toBe(true);
  });

  it("does not blur at level 2, the explicit opt-in", () => {
    expect(hasToBlurImage({ genres: ["Hentai"] }, 2)).toBe(false);
  });

  it("defaults to the blurring level when none is supplied", () => {
    expect(hasToBlurImage({ genres: ["Hentai"] })).toBe(true);
  });

  it.each(ADULT)("recognises %s as an adult genre", (genre) => {
    expect(hasToBlurImage({ genres: [genre] }, 0)).toBe(true);
  });

  it("matches genre names case-insensitively", () => {
    expect(hasToBlurImage({ genres: ["HENTAI"] }, 0)).toBe(true);
    expect(hasToBlurImage({ genres: ["hentai"] }, 0)).toBe(true);
    expect(hasToBlurImage({ genres: ["HeNtAi"] }, 0)).toBe(true);
  });

  it("blurs when an adult genre sits among non-adult ones", () => {
    expect(hasToBlurImage({ genres: ["Action", "Comedy", "Adult"] }, 0)).toBe(true);
  });

  it("leaves an all-ages series alone", () => {
    expect(hasToBlurImage({ genres: ["Action", "Comedy"] }, 0)).toBe(false);
  });

  it("does not blur a series with no genres at all", () => {
    expect(hasToBlurImage({ genres: [] }, 0)).toBe(false);
    expect(hasToBlurImage({ genres: null }, 0)).toBe(false);
    expect(hasToBlurImage({}, 0)).toBe(false);
  });

  it("does not treat a merely adjacent word as an adult genre", () => {
    // Substring matching would flag "Adultery" or "Adventure"; the
    // implementation compares whole strings, and should keep doing so.
    expect(hasToBlurImage({ genres: ["Adventure"] }, 0)).toBe(false);
    expect(hasToBlurImage({ genres: ["Adultery"] }, 0)).toBe(false);
  });
});

describe("filterAdultGenreIfNeeded", () => {
  const mangas = [
    { id: 1, genres: ["Action"] },
    { id: 2, genres: ["Hentai"] },
    { id: 3, genres: ["Action", "Erotica"] },
    { id: 4, genres: [] },
    { id: 5 },
  ];

  it("removes every adult series at level 1", () => {
    expect(filterAdultGenreIfNeeded(1, mangas).map((m) => m.id)).toEqual([1, 4, 5]);
  });

  it("returns the list untouched at level 0", () => {
    expect(filterAdultGenreIfNeeded(0, mangas)).toBe(mangas);
  });

  it("returns the list untouched at level 2", () => {
    expect(filterAdultGenreIfNeeded(2, mangas)).toBe(mangas);
  });

  it("defaults to not filtering", () => {
    expect(filterAdultGenreIfNeeded(undefined, mangas)).toBe(mangas);
  });

  it("keeps series with a missing genres field at level 1", () => {
    expect(filterAdultGenreIfNeeded(1, [{ id: 9 }])).toEqual([{ id: 9 }]);
  });

  it("does not mutate the input list", () => {
    const input = [...mangas];
    filterAdultGenreIfNeeded(1, input);
    expect(input).toHaveLength(mangas.length);
  });
});

describe("HTTP wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updateLibFromMal targets the refresh endpoint and unwraps data", async () => {
    axios.get.mockResolvedValueOnce({ data: { name: "Berserk" } });
    await expect(updateLibFromMal(2)).resolves.toEqual({ name: "Berserk" });
    expect(axios.get).toHaveBeenCalledWith("/api/user/library/2/update-from-mal");
  });

  it("updateVolumeOwned encodes the count in the path", async () => {
    await updateVolumeOwned(2, 12);
    expect(axios.patch).toHaveBeenCalledWith("/api/user/library/2/12");
  });

  it("updateVolumeOwned handles a negative custom-series id", async () => {
    await updateVolumeOwned(-3, 4);
    expect(axios.patch).toHaveBeenCalledWith("/api/user/library/-3/4");
  });
});
