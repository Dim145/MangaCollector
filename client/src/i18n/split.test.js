import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "./en.js";
import fr from "./fr.js";
import es from "./es.js";
import { CATALOGUE_LANGS, NAMESPACE_CHUNKS, PAGE_NAMESPACES } from "./split.js";

/*
 * 分 · What makes it safe to ship a page's text with the page.
 *
 * `split.js` moves namespaces out of the core catalogue; a page loads its
 * chunks before it renders (`routePages.js`). The way this goes wrong is
 * a component that uses one of those namespaces and can be shown without
 * that page — the header, a toast, a dialog another page opens — and
 * then draws raw keys. So this reads the source's import graph, from
 * `main.jsx`, static and dynamic imports alike, stopping at the pages
 * that load a chunk, and fails if any user of the chunk's namespaces is
 * still reachable.
 *
 * A "user" is a file with a string that starts like one of the
 * namespace's keys (`"settings.title"`, `` `tour.step${n}` ``), so a key
 * built from a data table counts as well as one passed to `t()`.
 */
const SRC = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["test", "assets", "content", "styles"]);

function sourceFiles(dir = SRC) {
  return fs.readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) return SKIP.has(entry) ? [] : sourceFiles(full);
    return /\.jsx?$/.test(entry) && !/\.test\./.test(entry) ? [full] : [];
  });
}

const files = sourceFiles();
const text = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, path.join(base, "index.js"), path.join(base, "index.jsx")]) {
    if (text.has(candidate)) return candidate;
  }
  return null;
}

const IMPORT = /(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const edges = new Map(
  files.map((file) => {
    const code = text
      .get(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    const to = [...code.matchAll(IMPORT)]
      .map((m) => resolveImport(file, m[1] ?? m[2] ?? m[3]))
      .filter(Boolean);
    return [file, to];
  }),
);

function keysOf(node, prefix = "") {
  return Object.entries(node).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
const allKeys = keysOf(en);

/** Files with a string that begins one of `ns`'s keys. */
function usersOf(ns) {
  const pattern = new RegExp(`["'\`](${ns}\\.[\\w.]*)`, "g");
  return files.filter((file) => {
    if (file.startsWith(path.join(SRC, "i18n"))) return false;
    for (const [, start] of text.get(file).matchAll(pattern)) {
      if (allKeys.some((key) => key.startsWith(start))) return true;
    }
    return false;
  });
}

// The pages `routePages.js` loads, by name.
const routePagesSrc = text.get(path.join(SRC, "routePages.js"));
const PAGES = Object.fromEntries(
  [...routePagesSrc.matchAll(/export const (\w+) = page\("(\w+)", \(\) => import\("(\.\/components\/[^"]+)"\)\)/g)].map(
    (m) => {
      expect(m[1]).toBe(m[2]);
      return [m[1], path.resolve(SRC, m[3])];
    },
  ),
);

/** Every file reachable from `main.jsx` without entering `barrier`, with how. */
function reachable(barrier) {
  const entry = path.join(SRC, "main.jsx");
  const parent = new Map([[entry, null]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    for (const next of edges.get(file) ?? []) {
      if (parent.has(next) || barrier.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  return parent;
}

function trail(parent, file) {
  const steps = [];
  for (let at = file; at; at = parent.get(at)) steps.unshift(path.relative(SRC, at));
  return steps.join(" → ");
}

describe("the catalogue split", () => {
  it("cuts catalogues that hold nothing but strings", () => {
    // The splitter serialises each chunk as JSON; a function or a number
    // in a catalogue would be dropped or changed on the way.
    for (const catalogue of [en, fr, es]) {
      const odd = keysOf(catalogue).filter((key) => {
        const value = key.split(".").reduce((node, part) => node[part], catalogue);
        return typeof value !== "string";
      });
      expect(odd).toEqual([]);
    }
    expect(CATALOGUE_LANGS).toEqual(["en", "fr", "es"]);
  });

  it("moves real namespaces, each into one chunk only", () => {
    const seen = new Map();
    for (const [chunk, namespaces] of Object.entries(NAMESPACE_CHUNKS)) {
      expect(namespaces.length, chunk).toBeGreaterThan(0);
      for (const ns of namespaces) {
        expect(Object.hasOwn(en, ns), `${ns} (chunk ${chunk})`).toBe(true);
        expect(seen.get(ns), `${ns} is in two chunks`).toBeUndefined();
        seen.set(ns, chunk);
      }
    }
  });

  it("gives every page a row, naming chunks that exist", () => {
    expect(Object.keys(PAGE_NAMESPACES).sort()).toEqual(Object.keys(PAGES).sort());
    for (const [page, chunks] of Object.entries(PAGE_NAMESPACES)) {
      for (const chunk of chunks) {
        expect(Object.hasOwn(NAMESPACE_CHUNKS, chunk), `${page} → ${chunk}`).toBe(true);
      }
    }
  });

  it("leaves no chunk unused", () => {
    const used = new Set(Object.values(PAGE_NAMESPACES).flat());
    expect(Object.keys(NAMESPACE_CHUNKS).filter((chunk) => !used.has(chunk))).toEqual([]);
  });

  it("never lets a component reach the screen before its page has loaded its text", () => {
    expect(Object.keys(PAGES).length).toBeGreaterThan(20);
    const leaks = [];
    for (const [chunk, namespaces] of Object.entries(NAMESPACE_CHUNKS)) {
      const loaders = new Set(
        Object.entries(PAGE_NAMESPACES)
          .filter(([, chunks]) => chunks.includes(chunk))
          .map(([page]) => PAGES[page]),
      );
      const parent = reachable(loaders);
      for (const ns of namespaces) {
        const users = usersOf(ns);
        expect(users.length, `nothing uses "${ns}" — drop it from split.js`).toBeGreaterThan(0);
        for (const file of users) {
          if (parent.has(file)) leaks.push(`${ns} (chunk ${chunk}): ${trail(parent, file)}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
