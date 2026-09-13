import { describe, expect, it } from "vitest";
import { extractTitleFromUrl, pickShareQuery } from "./share.js";

/*
 * Web Share Target payload → search query. The OS hands over any
 * subset of {title, text, url}, from any app, so the input is
 * genuinely untrusted and genuinely messy. The suite walks the
 * documented decision order and the sanitising rules that protect
 * the search bar from what arrives.
 */

describe("pickShareQuery", () => {
  describe("decision order", () => {
    it("prefers an explicit title over everything else", () => {
      expect(
        pickShareQuery({
          title: "Tokyo Ghoul",
          text: "some text",
          url: "https://myanimelist.net/manga/1/Berserk",
        }),
      ).toBe("Tokyo Ghoul");
    });

    it("falls back to free text when there is no title", () => {
      expect(pickShareQuery({ text: "Tokyo Ghoul" })).toBe("Tokyo Ghoul");
    });

    it("mines a URL that arrived in the text field", () => {
      expect(
        pickShareQuery({ text: "https://myanimelist.net/manga/1/Berserk" }),
      ).toBe("Berserk");
    });

    it("falls back to the url field last", () => {
      expect(
        pickShareQuery({ url: "https://myanimelist.net/manga/1/Berserk" }),
      ).toBe("Berserk");
    });

    it("keeps a bare URL rather than returning nothing", () => {
      // Guarantee from the module header: the search bar is never left
      // empty when the share carried some signal.
      expect(pickShareQuery({ url: "https://example.com" })).toBe(
        "https://example.com",
      );
    });
  });

  describe("empty input", () => {
    it.each([
      [{}],
      [undefined],
      [{ title: "", text: "", url: "" }],
      [{ title: "   ", text: "\n\t", url: "  " }],
      [{ title: null, text: undefined, url: 42 }],
    ])("returns null for %p", (input) => {
      expect(pickShareQuery(input)).toBeNull();
    });
  });

  describe("sanitising", () => {
    it("trims surrounding whitespace", () => {
      expect(pickShareQuery({ title: "  Berserk  " })).toBe("Berserk");
    });

    it("strips angle brackets and quotes from the payload", () => {
      const out = pickShareQuery({ title: "<script>alert(1)</script>Berserk" });
      expect(out).not.toContain("<");
      expect(out).not.toContain(">");
      expect(out).not.toContain('"');
      expect(out).not.toContain("'");
    });

    it.each([
      ["Tokyo Ghoul — MyAnimeList", "Tokyo Ghoul"],
      ["Berserk | Amazon.fr", "Berserk"],
      ["Naruto · Vinted", "Naruto"],
      ["One Piece - Booknode", "One Piece"],
    ])("drops the trailing site name in %p", (input, expected) => {
      expect(pickShareQuery({ title: input })).toBe(expected);
    });

    it("clamps the query to 200 characters", () => {
      const out = pickShareQuery({ title: "A".repeat(500) });
      expect(out).toHaveLength(200);
    });

    it("returns null when sanitising consumes the whole string", () => {
      expect(pickShareQuery({ title: "<>\"'" })).toBeNull();
    });

    it("ignores non-string fields instead of throwing", () => {
      expect(() =>
        pickShareQuery({ title: 42, text: {}, url: [] }),
      ).not.toThrow();
    });
  });
});

describe("extractTitleFromUrl", () => {
  it.each([
    ["https://myanimelist.net/manga/12345/Tokyo-Ghoul", "Tokyo Ghoul"],
    ["https://myanimelist.net/manga/2/Berserk", "Berserk"],
    ["https://myanimelist.net/manga/1/My_Hero_Academia", "My Hero Academia"],
  ])("reads the MyAnimeList slug in %p", (url, expected) => {
    expect(extractTitleFromUrl(url)).toBe(expected);
  });

  it.each([
    [
      "https://mangadex.org/title/3dd0b814-23f4-4342-b13f-d5f0dd7d4ca6/berserk-deluxe",
      "berserk deluxe",
    ],
    ["https://mangadex.org/title/abc-def/Chainsaw-Man", "Chainsaw Man"],
  ])("reads the MangaDex slug in %p", (url, expected) => {
    expect(extractTitleFromUrl(url)).toBe(expected);
  });

  it("falls back to the last meaningful path segment", () => {
    expect(
      extractTitleFromUrl("https://www.vinted.fr/items/berserk-tome-1"),
    ).toBe("berserk tome 1");
  });

  it("walks back past a purely numeric trailing segment", () => {
    expect(
      extractTitleFromUrl("https://example.com/berserk-deluxe/12345"),
    ).toBe("berserk deluxe");
  });

  it("stops at the first segment containing a letter, even when it is an id", () => {
    // Known limit of the heuristic, pinned here rather than wished
    // away: the walk stops at anything matching /[a-zA-Z]/, so
    // Amazon's own `/dp/B0123ABCDE` example from the docblock yields
    // the ASIN, not the slug before it. Only *purely numeric* trailing
    // segments are actually skipped. Widening the rule (requiring a
    // vowel, rejecting mixed alphanumerics) would change results for
    // every other host, so the behaviour stands as documented here.
    expect(
      extractTitleFromUrl("https://amazon.fr/berserk-deluxe/dp/B0123ABCDE"),
    ).toBe("B0123ABCDE");
  });

  it("URL-decodes the slug", () => {
    expect(extractTitleFromUrl("https://example.com/Tokyo%20Ghoul")).toBe(
      "Tokyo Ghoul",
    );
  });

  it("survives malformed percent-encoding", () => {
    expect(() => extractTitleFromUrl("https://example.com/100%")).not.toThrow();
  });

  it("collapses separators and whitespace", () => {
    expect(extractTitleFromUrl("https://example.com/a--b__c++d")).toBe(
      "a b c d",
    );
  });

  it("strips angle brackets out of a crafted slug", () => {
    // A URL like /manga/1/<script>… would otherwise round-trip into
    // the controlled input via `setQuery`.
    const out = extractTitleFromUrl(
      "https://myanimelist.net/manga/1/%3Cscript%3Ealert(1)%3C/script%3E",
    );
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });

  it.each([
    ["not a url"],
    [""],
    ["ftp://"],
    ["https://example.com"],
    ["https://example.com/"],
    ["https://example.com/123/456"],
  ])("returns null for %p", (input) => {
    expect(extractTitleFromUrl(input)).toBeNull();
  });
});

/*
 * 変 · Boundaries the earlier cases never reached. A share target is fed
 * by other apps' payloads, so the interesting inputs are the ones just
 * inside and just outside each rule rather than the obvious ones.
 */
describe("boundaries", () => {
  const query = (text) => pickShareQuery({ text });

  it("strips a site-name suffix behind any of its separators", () => {
    for (const sep of ["—", "-", "|", "·", "•"]) {
      expect(query(`Tokyo Ghoul ${sep} MyAnimeList`)).toBe("Tokyo Ghoul");
    }
  });

  it("strips a suffix of two characters but not of one", () => {
    // whitespace counts towards the two, so "— A" is a two-character
    // suffix and "—A" is a one-character one
    expect(query("Tokyo Ghoul —Ab")).toBe("Tokyo Ghoul");
    expect(query("Tokyo Ghoul — A")).toBe("Tokyo Ghoul");
    expect(query("Tokyo Ghoul —A")).toBe("Tokyo Ghoul —A");
  });

  it("stops stripping past forty characters of suffix", () => {
    const forty = "a".repeat(40);
    const fortyOne = "a".repeat(41);
    expect(query(`Tokyo Ghoul — ${forty}`)).toBe("Tokyo Ghoul");
    expect(query(`Tokyo Ghoul — ${fortyOne}`)).toBe(
      `Tokyo Ghoul — ${fortyOne}`,
    );
  });

  it("leaves a suffix alone when it is not plain site-name material", () => {
    expect(query("Tokyo Ghoul — Amazon!")).toBe("Tokyo Ghoul — Amazon!");
  });

  it("treats only a leading http(s) scheme as a URL", () => {
    // A slug with a hyphen is not used here on purpose: the site-name
    // stripper runs first and would eat its last word, which is a wart
    // of the ordering rather than of the URL rule under test.
    expect(query("https://myanimelist.net/manga/1/Berserk")).toBe("Berserk");
    expect(query("HTTPS://myanimelist.net/manga/1/Berserk")).toBe("Berserk");
    // a scheme in the middle is text, not a URL
    expect(query("read at https://example.com/x")).toBe(
      "read at https://example.com/x",
    );
    expect(query("ftp://example.com/manga/1/x")).toBe(
      "ftp://example.com/manga/1/x",
    );
  });

  it("requires a numeric id on the MyAnimeList path", () => {
    expect(
      extractTitleFromUrl("https://myanimelist.net/manga/12345/Tokyo-Ghoul"),
    ).toBe("Tokyo Ghoul");
    // no digits → not the MAL shape, so the generic walk answers instead
    expect(
      extractTitleFromUrl("https://myanimelist.net/manga/abc/Tokyo-Ghoul"),
    ).toBe("Tokyo Ghoul");
    expect(extractTitleFromUrl("https://MYANIMELIST.net/MANGA/7/Berserk")).toBe(
      "Berserk",
    );
  });

  it("reads a MangaDex title whatever the id looks like", () => {
    expect(
      extractTitleFromUrl(
        "https://mangadex.org/title/8f3e1c2a-0000-4aaa-bbbb-ccccccccdddd/vinland-saga",
      ),
    ).toBe("vinland saga");
    expect(
      extractTitleFromUrl("https://mangadex.org/TITLE/x/berserk_deluxe"),
    ).toBe("berserk deluxe");
  });

  it("gives up on a path with nothing but digits", () => {
    expect(extractTitleFromUrl("https://example.com/12/34/56")).toBeNull();
    expect(extractTitleFromUrl("https://example.com/")).toBeNull();
    expect(extractTitleFromUrl("https://example.com")).toBeNull();
  });

  it("clamps at exactly two hundred characters", () => {
    const title = "é".repeat(201);
    expect(pickShareQuery({ title }).length).toBe(200);
    const exact = "é".repeat(200);
    expect(pickShareQuery({ title: exact }).length).toBe(200);
  });
});
