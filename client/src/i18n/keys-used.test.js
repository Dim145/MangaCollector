import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import en from "./en.js";

/*
 * 鍵 · Every key the source asks for must exist.
 *
 * `t()` answers with the key itself when it finds nothing, which is a
 * sane fallback and an invisible failure: `dashboard.density_dense`
 * shipped as the density toggle's tooltip and its screen-reader label,
 * in all three languages, because the three keys `DensityToggle` used
 * had never been written. Nothing crashed, no test failed, and the
 * string was on the dashboard of every install.
 *
 * Static keys are checked exactly. A key built from a template —
 * `t(`dashboard.density_${id}`)` — cannot be resolved here, so the
 * prefix is checked instead: at least one key must start with it,
 * which is enough to catch a whole family that was never written.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["i18n", "test", "assets", "content", "styles"]);

function sources(dir = SRC) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return SKIP.has(entry) ? [] : sources(full);
    }
    if (!/\.jsx?$/.test(entry) || /\.test\./.test(entry)) return [];
    return [full];
  });
}

function resolve(key) {
  return key
    .split(".")
    .reduce(
      (node, part) =>
        node && typeof node === "object" && Object.hasOwn(node, part)
          ? node[part]
          : undefined,
      en,
    );
}

const files = sources();
const staticKeys = new Map(); // key → first file that asks for it
const prefixes = new Map(); // prefix → first file

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const where = path.relative(SRC, file);
  for (const [, key] of text.matchAll(/\bt\(\s*["']([\w.]+)["']/g)) {
    if (!staticKeys.has(key)) staticKeys.set(key, where);
  }
  for (const [, prefix] of text.matchAll(/\bt\(\s*`([\w.]+?)\$\{/g)) {
    if (!prefixes.has(prefix)) prefixes.set(prefix, where);
  }
}

describe("keys the interface asks for", () => {
  it("finds enough call sites to be worth trusting", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(staticKeys.size).toBeGreaterThan(500);
  });

  it("resolves every literal key to a string", () => {
    const missing = [...staticKeys]
      .filter(([key]) => typeof resolve(key) !== "string")
      .map(([key, where]) => `${key}  (${where})`);
    expect(missing).toEqual([]);
  });

  it("finds at least one key behind every computed one", () => {
    const flat = (node, prefix = "") =>
      Object.entries(node).flatMap(([k, v]) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? flat(v, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      );
    const all = flat(en);
    const orphans = [...prefixes]
      .filter(([prefix]) => !all.some((key) => key.startsWith(prefix)))
      .map(([prefix, where]) => `${prefix}…  (${where})`);
    expect(orphans).toEqual([]);
  });
});
