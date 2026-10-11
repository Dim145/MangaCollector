import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_PATHS, pageForPath, StatsPage, AuthorPage, YearInReviewPage, About } from "./routePages.js";

/*
 * 頁 · The page a URL names, and the agreement between the two tables
 * that act on it: `PAGE_PATHS` (loaded before the first render) and
 * `ROUTE_MODULES` in `vite.config.js` (modulepreloaded by `index.html`).
 * When they disagree, one of the two optimisations silently stops.
 */
const here = import.meta.dirname;

function viteTable() {
  const src = fs.readFileSync(path.resolve(here, "../vite.config.js"), "utf8");
  const body = src.match(/const ROUTE_MODULES = \{([\s\S]*?)\n\};/)[1];
  return Object.fromEntries(
    [...body.matchAll(/"([^"]+)":\s*"src\/components\/([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
}

function registryFiles() {
  const src = fs.readFileSync(path.resolve(here, "routePages.js"), "utf8");
  const files = Object.fromEntries(
    [...src.matchAll(/export const (\w+) = page\("\w+", \(\) => import\("\.\/components\/([^"]+)"\)\)/g)].map(
      (m) => [m[1], m[2]],
    ),
  );
  const table = src.match(/export const PAGE_PATHS = \{([\s\S]*?)\n\};/)[1];
  return Object.fromEntries(
    [...table.matchAll(/"([^"]+)":\s*(\w+),/g)].map((m) => [m[1], files[m[2]]]),
  );
}

describe("pageForPath", () => {
  it("names the page of an exact path", () => {
    expect(pageForPath("/stats")).toBe(StatsPage);
    expect(pageForPath("/")).toBe(About);
    expect(pageForPath("/year-in-review")).toBe(YearInReviewPage);
  });

  it("names the page of a path with a parameter, by its longest prefix", () => {
    expect(pageForPath("/author/1234")).toBe(AuthorPage);
    expect(pageForPath("/year-in-review/2025/3")).toBe(YearInReviewPage);
  });

  it("knows nothing of a path it does not route", () => {
    expect(pageForPath("/nope")).toBeNull();
    expect(pageForPath("/author/")).toBeNull();
    expect(pageForPath(undefined)).toBeNull();
  });
});

describe("the two route tables", () => {
  it("list the same paths, each to the same component file", () => {
    const vite = viteTable();
    const registry = registryFiles();
    expect(Object.keys(registry).sort()).toEqual(Object.keys(vite).sort());
    for (const [route, file] of Object.entries(vite)) {
      expect([route, registry[route]]).toEqual([route, file]);
    }
    expect(Object.keys(PAGE_PATHS)).toHaveLength(Object.keys(vite).length);
  });
});
