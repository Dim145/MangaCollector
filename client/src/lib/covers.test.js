import { afterEach, describe, expect, it } from "vitest";
import {
  coverCandidates,
  coverProxyEnabled,
  coverSources,
  coverSrc,
  isProxiedCover,
  originalCoverSrc,
  setCoverProxy,
} from "./covers.js";

/*
 * 影 · The relay is off unless the operator turned it on, and even then
 * it only stands between the reader and the two cover CDNs — never in
 * front of our own poster paths, a data: preview, or an address on this
 * origin, all of which would be a pointless round trip at best.
 */

afterEach(() => setCoverProxy(false));

describe("coverSrc", () => {
  it("changes nothing while the relay is off", () => {
    expect(coverProxyEnabled()).toBe(false);
    const url = "https://uploads.mangadex.org/covers/a/b.jpg";
    expect(coverSrc(url)).toBe(url);
  });

  it("routes a CDN cover through the relay once it is on", () => {
    setCoverProxy(true);
    expect(coverSrc("https://uploads.mangadex.org/covers/a/b.jpg")).toBe(
      "/api/user/cover?src=https%3A%2F%2Fuploads.mangadex.org%2Fcovers%2Fa%2Fb.jpg",
    );
  });

  it("leaves alone everything that is not somebody else's http address", () => {
    setCoverProxy(true);
    for (const untouched of [
      "/api/user/storage/poster/42", // ours already
      "data:image/png;base64,iVBORw0KGgo=",
      "blob:http://localhost/9a1f",
      "",
      null,
      undefined,
      "not a url",
      `${location.origin}/covers/local.jpg`, // this very origin
    ]) {
      expect(coverSrc(untouched)).toBe(untouched);
    }
  });

  it("only relays the two hosts the server will fetch from", () => {
    setCoverProxy(true);
    for (const direct of [
      "https://books.google.com/books/content?id=x&zoom=1",
      "https://covers.openlibrary.org/b/id/1-L.jpg",
      "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/x.jpg",
      // A lookalike is not the host, and neither is its parent domain.
      "https://cdn.myanimelist.net.evil.test/a.jpg",
      "https://myanimelist.net/images/manga/1.jpg",
      // The server refuses plain http on the right host too.
      "http://cdn.myanimelist.net/images/manga/2/253146l.jpg",
    ]) {
      expect(coverSrc(direct)).toBe(direct);
    }
  });

  it("survives a URL it cannot parse", () => {
    setCoverProxy(true);
    expect(coverSrc("https://")).toBe("https://");
  });
});

describe("reading a relayed URL back", () => {
  it("recognises one of ours and gives the upstream address back", () => {
    setCoverProxy(true);
    const url = "https://cdn.myanimelist.net/images/manga/2/253146l.jpg";
    const proxied = coverSrc(url);
    expect(isProxiedCover(proxied)).toBe(true);
    // This is what CoverImage retries with when a relayed cover fails,
    // so a relay that is down costs a second request, not a hole in
    // the shelf.
    expect(originalCoverSrc(proxied)).toBe(url);
  });

  it("says no to anything else", () => {
    expect(isProxiedCover("https://uploads.mangadex.org/covers/a.jpg")).toBe(
      false,
    );
    expect(originalCoverSrc("https://uploads.mangadex.org/covers/a.jpg")).toBe(
      null,
    );
    expect(originalCoverSrc("/api/user/cover?src=")).toBe(null);
  });
});

/*
 * 寸 · Renditions. The shelf asked for each cover's largest file
 * everywhere; these pin which smaller ones exist and which hosts have
 * none, because a wrong guess is a broken image on every tile.
 */
const MD_MANGA = "1f5a94b3-08f9-4b58-8354-db5cf22043d6";
const MD_FILE = "198fec8c-a7f6-4045-8cf6-5c782fd87c72";

describe("coverCandidates", () => {
  it("offers MangaDex's two thumbnails for a stored 512 thumbnail", () => {
    const base = `https://uploads.mangadex.org/covers/${MD_MANGA}/${MD_FILE}.jpg`;
    expect(coverCandidates(`${base}.512.jpg`)).toEqual([
      { url: `${base}.256.jpg`, width: 256 },
      { url: `${base}.512.jpg`, width: 512 },
    ]);
  });

  it("offers the same pair for an original MangaDex file", () => {
    const base = `https://uploads.mangadex.org/covers/${MD_MANGA}/${MD_FILE}.png`;
    expect(coverCandidates(base).map((c) => c.url)).toEqual([
      `${base}.256.jpg`,
      `${base}.512.jpg`,
    ]);
  });

  it("offers MyAnimeList's two WebP renditions for a large JPEG", () => {
    expect(
      coverCandidates("https://cdn.myanimelist.net/images/manga/1/259070l.jpg"),
    ).toEqual([
      { url: "https://cdn.myanimelist.net/images/manga/1/259070.webp", width: 225 },
      { url: "https://cdn.myanimelist.net/images/manga/1/259070l.webp", width: 420 },
    ]);
  });

  it("reads a MyAnimeList address whatever size or format was stored", () => {
    for (const stored of [
      "https://cdn.myanimelist.net/images/manga/2/253146.jpg",
      "https://cdn.myanimelist.net/images/manga/2/253146t.jpg",
      "https://cdn.myanimelist.net/images/manga/2/253146l.webp",
    ]) {
      expect(coverCandidates(stored)?.[1].url).toBe(
        "https://cdn.myanimelist.net/images/manga/2/253146l.webp",
      );
    }
  });

  it("knows no renditions for anything else", () => {
    for (const url of [
      "/api/user/storage/poster/42",
      "https://books.google.com/books/content?id=x&img=1",
      "https://cdn.myanimelist.net/r/50x70/images/manga/1/259070.jpg?s=abc",
      "https://cdn.myanimelist.net/images/manga/1/259070l.jpg?s=abc",
      `https://uploads.mangadex.org/covers/${MD_MANGA}/not-a-file.jpg`,
      "https://example.org/cover.jpg",
      "",
      null,
    ]) {
      expect(coverCandidates(url)).toBeNull();
    }
  });
});

describe("coverSources", () => {
  it("puts the candidates in srcset and the largest in src", () => {
    expect(
      coverSources("https://cdn.myanimelist.net/images/manga/1/259070l.jpg"),
    ).toEqual({
      src: "https://cdn.myanimelist.net/images/manga/1/259070l.webp",
      srcSet:
        "https://cdn.myanimelist.net/images/manga/1/259070.webp 225w, " +
        "https://cdn.myanimelist.net/images/manga/1/259070l.webp 420w",
    });
  });

  it("relays every candidate when the relay is on, and none when asked not to", () => {
    setCoverProxy(true);
    const url = `https://uploads.mangadex.org/covers/${MD_MANGA}/${MD_FILE}.jpg.512.jpg`;
    const relayed = coverSources(url);
    expect(isProxiedCover(relayed.src)).toBe(true);
    for (const entry of relayed.srcSet.split(", ")) {
      const [candidate, width] = entry.split(" ");
      expect(isProxiedCover(candidate)).toBe(true);
      expect(width).toMatch(/^\d+w$/);
    }
    const direct = coverSources(url, { relay: false });
    expect(direct.src).toBe(url);
    expect(direct.srcSet).not.toContain("/api/user/cover");
  });

  it("leaves an address with no renditions as it was", () => {
    expect(coverSources("/api/user/storage/poster/42")).toEqual({
      src: "/api/user/storage/poster/42",
      srcSet: undefined,
    });
  });
});
