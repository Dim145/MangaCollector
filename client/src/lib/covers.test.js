import { afterEach, describe, expect, it } from "vitest";
import {
  coverProxyEnabled,
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
