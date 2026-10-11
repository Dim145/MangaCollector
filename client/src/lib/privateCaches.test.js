import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE_CACHE_NAMES } from "./privateCaches.js";

/*
 * Every runtime bucket `vite.config.js` declares is either one of the
 * account's (purged on every exit) or deliberately public. A new bucket
 * has to be put on one side or the other here, or this fails — which is
 * the point: an unlisted private bucket would outlive a logout.
 */
const PUBLIC = ["app-assets", "mal-covers", "mangadex-covers", "google-books-thumbnails", "public-config"];

describe("private caches", () => {
  it("cover every bucket the service worker declares, public ones aside", () => {
    const config = readFileSync(
      path.resolve(import.meta.dirname, "../../vite.config.js"),
      "utf8",
    );
    const declared = [...config.matchAll(/cacheName:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(
        PRIVATE_CACHE_NAMES.includes(name) || PUBLIC.includes(name),
        `bucket "${name}" is neither private nor known-public`,
      ).toBe(true);
    }
    for (const name of PRIVATE_CACHE_NAMES) {
      expect(declared, `private bucket "${name}" is not declared`).toContain(name);
    }
  });
});
