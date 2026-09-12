import { describe, expect, it } from "vitest";
import { detectPasteIntent } from "./pasteDetect.js";

/*
 * Paste classifier for the Add page's search input. A null result
 * means "let the native paste through unchanged", so a false positive
 * is worse than a miss: it hijacks what the user typed.
 */

describe("detectPasteIntent", () => {
  describe("no recognisable shape", () => {
    it.each([
      [""],
      ["   "],
      ["Berserk"],
      ["just some prose about manga"],
      ["https://example.com/whatever"],
      ["https://myanimelist.net/anime/1/Cowboy_Bebop"],
    ])("returns null for %p", (input) => {
      expect(detectPasteIntent(input)).toBeNull();
    });

    it.each([[null], [undefined], [42], [{}], [[]]])(
      "returns null for the non-string %p without throwing",
      (input) => {
        expect(() => detectPasteIntent(input)).not.toThrow();
        expect(detectPasteIntent(input)).toBeNull();
      },
    );
  });

  describe("MyAnimeList", () => {
    it("extracts the slug as the query", () => {
      expect(detectPasteIntent("https://myanimelist.net/manga/2/Berserk")).toEqual({
        kind: "mal",
        query: "Berserk",
        raw: "https://myanimelist.net/manga/2/Berserk",
      });
    });

    it("decodes and normalises a multi-word slug", () => {
      expect(
        detectPasteIntent("https://myanimelist.net/manga/1/Demon-Slayer_Kimetsu").query,
      ).toBe("Demon Slayer Kimetsu");
    });

    it("falls back to the numeric id when there is no slug", () => {
      expect(detectPasteIntent("https://myanimelist.net/manga/2").query).toBe("2");
    });

    it("accepts the www host and a missing scheme", () => {
      expect(detectPasteIntent("www.myanimelist.net/manga/2/Berserk").kind).toBe("mal");
      expect(detectPasteIntent("myanimelist.net/manga/2/Berserk").kind).toBe("mal");
    });

    it("trims surrounding whitespace before matching", () => {
      expect(detectPasteIntent("  https://myanimelist.net/manga/2/Berserk  ").kind).toBe("mal");
    });
  });

  describe("MangaDex", () => {
    it("extracts the slug", () => {
      expect(
        detectPasteIntent(
          "https://mangadex.org/title/3dd0b814-23f4-4342-b13f-d5f0dd7d4ca6/berserk",
        ),
      ).toMatchObject({ kind: "mangadex", query: "berserk" });
    });

    it("falls back to the uuid when there is no slug", () => {
      expect(
        detectPasteIntent("https://mangadex.org/title/3dd0b814-23f4-4342").query,
      ).toBe("3dd0b814-23f4-4342");
    });
  });

  describe("AniList", () => {
    it("extracts the slug", () => {
      expect(detectPasteIntent("https://anilist.co/manga/30002/Berserk")).toMatchObject({
        kind: "anilist",
        query: "Berserk",
      });
    });
  });

  describe("ISBN", () => {
    it.each([
      ["9782505011514", "9782505011514"],
      ["978-2-505-01151-4", "9782505011514"],
      ["978 2505 011514", "9782505011514"],
      ["2505011516", "2505011516"],
    ])("classifies %p as ISBN %p", (input, digits) => {
      expect(detectPasteIntent(input)).toMatchObject({ kind: "isbn", query: digits });
    });

    it("keeps the original string in raw", () => {
      expect(detectPasteIntent("978-2-505-01151-4").raw).toBe("978-2-505-01151-4");
    });

    it.each([
      ["12345678901"],
      ["123456789012"],
      ["12345678901234"],
      ["I read 9782505011514 yesterday"],
    ])("rejects %p", (input) => {
      expect(detectPasteIntent(input)).toBeNull();
    });
  });

  describe("precedence", () => {
    it("classifies a URL containing a digit run as a URL, not an ISBN", () => {
      // Order matters per the module comment: host patterns win.
      const out = detectPasteIntent("https://myanimelist.net/manga/9782505011514/Berserk");
      expect(out.kind).toBe("mal");
    });
  });
});
