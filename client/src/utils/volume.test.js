import { beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP wrappers in this module take the shared axios instance,
// whose module graph reaches auth.js / Dexie / the query client. Stub
// it at the boundary so the suite stays a unit test of the URL shapes.
vi.mock("./axios", () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const axios = (await import("./axios")).default;
const {
  formatShortDate,
  getAllVolumes,
  getAllVolumesByID,
  summarizeRange,
  updateVolumeByID,
} = await import("./volume.js");

describe("summarizeRange", () => {
  it("returns an empty string for an empty list", () => {
    expect(summarizeRange([])).toBe("");
  });

  it("renders a single volume as a bare number", () => {
    expect(summarizeRange([7])).toBe("7");
  });

  it("collapses a contiguous run into a dash range", () => {
    expect(summarizeRange([1, 2, 3])).toBe("1–3");
  });

  it("keeps a two-volume run as a range, not a pair", () => {
    expect(summarizeRange([4, 5])).toBe("4–5");
  });

  it("separates discontiguous runs with a comma", () => {
    expect(summarizeRange([1, 2, 3, 5, 6, 8])).toBe("1–3, 5–6, 8");
  });

  it("sorts the input before grouping", () => {
    expect(summarizeRange([8, 2, 1, 6, 3, 5])).toBe("1–3, 5–6, 8");
  });

  it("does not mutate the caller's array", () => {
    const input = [3, 1, 2];
    summarizeRange(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("handles a gap of exactly one volume", () => {
    expect(summarizeRange([1, 3])).toBe("1, 3");
  });

  it("handles a long single run", () => {
    expect(summarizeRange(Array.from({ length: 50 }, (_, i) => i + 1))).toBe("1–50");
  });

  it("handles alternating singletons", () => {
    expect(summarizeRange([1, 3, 5, 7])).toBe("1, 3, 5, 7");
  });

  it("uses an en dash, not a hyphen", () => {
    // The en dash is deliberate typography; a hyphen would read as a
    // minus next to the volume numbers in the gap-suggestion card.
    expect(summarizeRange([1, 2])).toContain("–");
    expect(summarizeRange([1, 2])).not.toContain("-");
  });
});

describe("formatShortDate", () => {
  it.each([[null], [undefined], [""], [0]])(
    "returns an empty string for the falsy input %p",
    (input) => {
      expect(formatShortDate(input)).toBe("");
    },
  );

  it("returns an empty string for an unparseable date", () => {
    // `new Date("nope").toLocaleDateString()` yields "Invalid Date"
    // rather than throwing — callers interpolate the result straight
    // into a label, so that string must never reach the UI.
    expect(formatShortDate("nope")).toBe("");
  });

  it("renders day, abbreviated month and year", () => {
    const out = formatShortDate("2026-03-15T12:00:00Z");
    expect(out).toContain("15");
    expect(out).toContain("2026");
    expect(out).toMatch(/Mar/i);
  });
});

describe("HTTP wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAllVolumes hits the collection endpoint and unwraps data", async () => {
    axios.get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    await expect(getAllVolumes()).resolves.toEqual([{ id: 1 }]);
    expect(axios.get).toHaveBeenCalledWith("/api/user/volume");
  });

  it("getAllVolumesByID scopes the request to the series", async () => {
    axios.get.mockResolvedValueOnce({ data: [] });
    await getAllVolumesByID(1234);
    expect(axios.get).toHaveBeenCalledWith("/api/user/volume/1234");
  });

  it("getAllVolumesByID keeps a negative custom-series id intact", async () => {
    // Custom (non-MAL) series carry a negative mal_id — the sign must
    // survive into the path or the lookup silently targets the wrong
    // series. See `server/src/services/library.rs`.
    axios.get.mockResolvedValueOnce({ data: [] });
    await getAllVolumesByID(-7);
    expect(axios.get).toHaveBeenCalledWith("/api/user/volume/-7");
  });

  it("updateVolumeByID PATCHes the collection with a body, not a path", async () => {
    await updateVolumeByID(3, true, 7.99, "Fnac");
    expect(axios.patch).toHaveBeenCalledWith("/api/user/volume", {
      id: 3,
      owned: true,
      price: 7.99,
      store: "Fnac",
    });
  });
});
