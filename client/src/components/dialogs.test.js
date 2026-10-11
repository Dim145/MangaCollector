import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * 留 · Every modal `<dialog>` is clipped.
 *
 * The browser gives a modal dialog `overflow: auto`. A panel arriving
 * translated — the volume drawer from the right, a sheet from below —
 * made the dialog scrollable by the panel's own size, the focus given
 * on opening scrolled it into view, and the entrance animation then ran
 * under that scroll: the drawer showed up 80 px left of its place and
 * jumped back when the animation ended. `overflow: clip` makes the
 * dialog no scroll container at all (`hidden` still lets a focus scroll
 * it). The content scrolls inside; the dialog never does.
 */

const root = path.resolve(import.meta.dirname);

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.jsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

/** Each `<dialog` opening tag in JSX (comments skipped) and its className. */
function dialogs(file) {
  const text = fs.readFileSync(file, "utf8");
  const found = [];
  for (const match of text.matchAll(/<dialog\b/g)) {
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const line = text.slice(lineStart, match.index).trim();
    if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) continue;
    const at = text.indexOf("className=", match.index);
    found.push({ file: path.relative(root, file), className: text.slice(at, at + 400) });
  }
  return found;
}

describe("modal dialogs", () => {
  const all = sources(root).flatMap(dialogs);

  it("are found (the scan reads the real components)", () => {
    expect(all.length).toBeGreaterThanOrEqual(5);
  });

  it.each(all.map((d) => [d.file, d.className]))("%s is clipped, never scrolled", (_file, className) => {
    expect(className).toMatch(/\boverflow-clip\b/);
  });
});
