import { describe, expect, it, vi } from "vitest";

// Dexie opens a real IndexedDB the first time a table is touched, which
// jsdom does not implement. Only the cache helpers use it and none of
// the pure functions under test do, so stub the module wholesale.
vi.mock("./db.js", () => ({
  db: { isbnCache: { get: vi.fn(), put: vi.fn() } },
}));
vi.mock("@/utils/axios.js", () => ({ default: { get: vi.fn() } }));

const { detectCoffret, getApiKey, normalizeISBN, parseTitleVolume, setApiKey } =
  await import("./isbn.js");

describe("normalizeISBN", () => {
  it("accepts a valid ISBN-13", () => {
    expect(normalizeISBN("9782505011514")).toBe("9782505011514");
  });

  it("accepts a valid ISBN-10", () => {
    expect(normalizeISBN("2505011516")).toBe("2505011516");
  });

  it("accepts the ISBN-10 'X' check digit in either case", () => {
    expect(normalizeISBN("080442957X")).toBe("080442957X");
    expect(normalizeISBN("080442957x")).toBe("080442957x");
  });

  it("strips hyphens and spaces before validating", () => {
    expect(normalizeISBN("978-2-505-01151-4")).toBe("9782505011514");
    expect(normalizeISBN(" 978 2505 011514 ")).toBe("9782505011514");
  });

  it("rejects a correct-length code with a bad checksum", () => {
    // The load-bearing case: a half-decoded barcode yields 13 plausible
    // digits. Without the checksum gate each one burns a Google Books
    // quota call.
    expect(normalizeISBN("9782505011515")).toBeNull();
    expect(normalizeISBN("9999999999999")).toBeNull();
    expect(normalizeISBN("2505011517")).toBeNull();
  });

  it.each([
    ["", "empty"],
    ["123", "too short"],
    ["12345678901", "11 digits"],
    ["978250501151", "12 digits"],
    ["97825050115141", "14 digits"],
    ["97825050115X4", "letter in the middle"],
    ["abcdefghij", "letters"],
  ])("rejects %p (%s)", (input) => {
    expect(normalizeISBN(input)).toBeNull();
  });

  it.each([[null], [undefined], [0], [NaN], [{}], [[]]])(
    "rejects the non-string input %p without throwing",
    (input) => {
      expect(() => normalizeISBN(input)).not.toThrow();
      expect(normalizeISBN(input)).toBeNull();
    },
  );
});

describe("parseTitleVolume", () => {
  it.each([[""], [null], [undefined]])(
    "returns an empty result for %p",
    (input) => {
      expect(parseTitleVolume(input)).toEqual({ title: "", volume: null });
    },
  );

  it.each([
    ["Berserk, Vol. 12", "Berserk", 12],
    ["Berserk Volume 12", "Berserk", 12],
    ["Berserk vol 12", "Berserk", 12],
    ["Berserk, Tome 12", "Berserk", 12],
    ["Berserk T.12", "Berserk", 12],
    ["Berserk Book 12", "Berserk", 12],
    ["Berserk Part 12", "Berserk", 12],
    ["ベルセルク 第12巻", "ベルセルク", 12],
    ["ベルセルク 12巻", "ベルセルク", 12],
    ["Berserk #12", "Berserk", 12],
    ["Berserk 12", "Berserk", 12],
  ])("parses %p into title %p and volume %i", (input, title, volume) => {
    expect(parseTitleVolume(input)).toEqual({ title, volume });
  });

  it.each([
    ["Berserk Part 12", "Berserk", 12],
    ["Naruto Print 3", "Naruto Print", 3],
  ])("does not eat the trailing 't' of the preceding word in %p", (input, title, volume) => {
    // Regression guard: the `t.` pattern used to match the "t 12" inside
    // "Part 12" — it runs before the dedicated `part` pattern — and
    // truncated the series name to "Berserk Par".
    expect(parseTitleVolume(input)).toEqual({ title, volume });
  });

  it("is case-insensitive on the volume keyword", () => {
    expect(parseTitleVolume("Berserk VOL. 3").volume).toBe(3);
    expect(parseTitleVolume("Berserk TOME 3").volume).toBe(3);
  });

  it("strips trailing punctuation left behind by the removal", () => {
    expect(parseTitleVolume("Berserk: Vol. 3").title).toBe("Berserk");
    expect(parseTitleVolume("Berserk - Vol. 3").title).toBe("Berserk");
    expect(parseTitleVolume("Berserk — Tome 3").title).toBe("Berserk");
  });

  it("returns a null volume when the title carries no volume marker", () => {
    expect(parseTitleVolume("Berserk")).toEqual({ title: "Berserk", volume: null });
  });

  it("trims surrounding whitespace off a bare title", () => {
    expect(parseTitleVolume("  Berserk  ").title).toBe("Berserk");
  });

  it("never returns an empty title when the whole string was the marker", () => {
    // Falling back to the original string keeps the search box from
    // being handed "" and querying the entire catalogue.
    const { title } = parseTitleVolume("Vol. 3");
    expect(title).not.toBe("");
  });

  it("clamps absurdly long input to 500 chars before running the regexes", () => {
    // ReDoS guard. Nine patterns over unbounded attacker-influenced
    // input is the shape the cap exists to defuse.
    const long = `${"A".repeat(5000)}, Vol. 3`;
    const { title } = parseTitleVolume(long);
    expect(title.length).toBeLessThanOrEqual(500);
  });

  it("completes promptly on pathological input", () => {
    const started = Date.now();
    parseTitleVolume(`${" ".repeat(10_000)}1`.repeat(10));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("detectCoffret", () => {
  it.each([[null], [undefined], [{}], [{ title: "" }]])(
    "reports %p as not a coffret",
    (input) => {
      expect(detectCoffret(input)).toEqual({ isCoffret: false });
    },
  );

  it.each([
    "Berserk Box Set",
    "Berserk boxset",
    "Berserk box-set",
    "Coffret Berserk",
    "Berserk Intégrale",
    "Berserk Integrale",
    "Berserk Slipcase Edition",
    "Berserk Complete Series",
    "Berserk Complete Collection",
  ])("detects the keyword in %p", (title) => {
    expect(detectCoffret({ title }).isCoffret).toBe(true);
  });

  it("prefers rawTitle over title when both are present", () => {
    expect(detectCoffret({ rawTitle: "Berserk Box Set", title: "Berserk" }).isCoffret).toBe(true);
  });

  it.each([
    ["Berserk Vol. 1-13", 1, 13],
    ["Berserk Volumes 1 to 3", 1, 3],
    ["Berserk Tomes 1 à 5", 1, 5],
    ["Berserk #1-3", 1, 3],
    ["Berserk Books 2–4", 2, 4],
  ])("extracts the range from %p", (title, start, end) => {
    expect(detectCoffret({ title })).toMatchObject({
      isCoffret: true,
      volStart: start,
      volEnd: end,
    });
  });

  it("returns the original title as the coffret name", () => {
    expect(detectCoffret({ title: "Berserk Box Set" }).name).toBe("Berserk Box Set");
  });

  it("leaves the range undefined for a keyword-only match", () => {
    const out = detectCoffret({ title: "Berserk Box Set" });
    expect(out.isCoffret).toBe(true);
    expect(out.volStart).toBeUndefined();
    expect(out.volEnd).toBeUndefined();
  });

  it("ignores an inverted range", () => {
    const out = detectCoffret({ title: "Berserk Vol. 13-1" });
    expect(out.volStart).toBeUndefined();
    expect(out.volEnd).toBeUndefined();
  });

  it("ignores a range starting at zero", () => {
    const out = detectCoffret({ title: "Berserk Vol. 0-3" });
    expect(out.volStart).toBeUndefined();
  });

  it("accepts a single-volume range", () => {
    expect(detectCoffret({ title: "Berserk Vol. 3-3" })).toMatchObject({
      volStart: 3,
      volEnd: 3,
    });
  });

  it("does not flag an ordinary single volume", () => {
    expect(detectCoffret({ title: "Berserk, Vol. 12" }).isCoffret).toBe(false);
  });
});

describe("API key storage", () => {
  it("reports no key when none was stored", () => {
    expect(getApiKey()).toBeNull();
  });

  it("round-trips a key", () => {
    setApiKey("AIza-test-key");
    expect(getApiKey()).toBe("AIza-test-key");
  });

  it("trims surrounding whitespace on write", () => {
    setApiKey("  AIza-test-key  ");
    expect(getApiKey()).toBe("AIza-test-key");
  });

  it.each([[""], ["   "], [null], [undefined]])(
    "clears the stored key when given %p",
    (input) => {
      setApiKey("AIza-test-key");
      setApiKey(input);
      expect(getApiKey()).toBeNull();
    },
  );

  it("does not throw when localStorage is unavailable", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => getApiKey()).not.toThrow();
    expect(getApiKey()).toBeNull();
    spy.mockRestore();
  });
});
