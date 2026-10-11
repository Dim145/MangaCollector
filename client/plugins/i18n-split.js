import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 分 · Cuts each translation catalogue into a core and per-page chunks,
 * at build time, from the files translators actually edit.
 *
 * Modules it serves (see `src/i18n/split.js` for the why):
 *
 *   virtual:mc-i18n                 → `core` and `chunks`: maps of loaders,
 *                                     one `import()` per language and chunk
 *   virtual:mc-i18n/<lang>/core     → every namespace no chunk claims
 *   virtual:mc-i18n/<lang>/<chunk>  → the namespaces of that chunk
 *
 * Each module is `export default JSON.parse("…")` rather than an object
 * literal: V8 parses a JSON string several times faster than the same
 * data written as JavaScript, and a catalogue is nothing but strings
 * (`split.test.js` checks it).
 *
 * The catalogues and the split table are read with a fresh `import()`
 * keyed on their modification time, so the dev server picks up an
 * edited string without a restart (`addWatchFile` tells it to look).
 */
const PUBLIC = "virtual:mc-i18n";
const PREFIX = "\0mc-i18n:";

async function freshImport(file) {
  const stamp = fs.statSync(file).mtimeMs;
  return import(`${pathToFileURL(file).href}?t=${stamp}`);
}

/** The facade id of a split module, parsed — or null. */
export function parseI18nId(id) {
  if (typeof id !== "string" || !id.startsWith(PREFIX)) return null;
  const rest = id.slice(PREFIX.length);
  if (rest === "loaders") return { loaders: true };
  const [lang, chunk] = rest.split("/");
  return { lang, chunk };
}

export default function i18nSplit({ dir }) {
  const splitFile = path.join(dir, "split.js");

  return {
    name: "mc-i18n-split",
    resolveId(id) {
      if (id === PUBLIC) return `${PREFIX}loaders`;
      if (id.startsWith(`${PUBLIC}/`)) return PREFIX + id.slice(PUBLIC.length + 1);
      return null;
    },
    async load(id) {
      const parsed = parseI18nId(id);
      if (!parsed) return null;
      this.addWatchFile(splitFile);
      const { CATALOGUE_LANGS, NAMESPACE_CHUNKS } = await freshImport(splitFile);

      if (parsed.loaders) {
        const loader = (lang, chunk) =>
          `${JSON.stringify(lang)}: () => import(${JSON.stringify(`${PUBLIC}/${lang}/${chunk}`)})`;
        const core = CATALOGUE_LANGS.map((lang) => loader(lang, "core")).join(",\n  ");
        const chunks = Object.keys(NAMESPACE_CHUNKS)
          .map(
            (chunk) =>
              `${JSON.stringify(chunk)}: { ${CATALOGUE_LANGS.map((lang) => loader(lang, chunk)).join(", ")} }`,
          )
          .join(",\n  ");
        return `export const core = {\n  ${core}\n};\nexport const chunks = {\n  ${chunks}\n};\n`;
      }

      const { lang, chunk } = parsed;
      if (!CATALOGUE_LANGS.includes(lang)) {
        this.error(`mc-i18n: unknown language "${lang}"`);
      }
      const file = path.join(dir, `${lang}.js`);
      this.addWatchFile(file);
      const catalogue = (await freshImport(file)).default;

      let subset;
      if (chunk === "core") {
        const claimed = new Set(Object.values(NAMESPACE_CHUNKS).flat());
        subset = Object.fromEntries(Object.entries(catalogue).filter(([ns]) => !claimed.has(ns)));
      } else if (Object.hasOwn(NAMESPACE_CHUNKS, chunk)) {
        subset = {};
        for (const ns of NAMESPACE_CHUNKS[chunk]) {
          if (!Object.hasOwn(catalogue, ns)) {
            this.error(`mc-i18n: "${ns}" (chunk "${chunk}") is not a namespace of ${lang}.js`);
          }
          subset[ns] = catalogue[ns];
        }
      } else {
        this.error(`mc-i18n: unknown chunk "${chunk}"`);
      }
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(subset))});\n`;
    },
  };
}
