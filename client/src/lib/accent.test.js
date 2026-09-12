import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENTS,
  DEFAULT_ACCENT,
  applyAccentToDocument,
  bootstrapAccentFromStorage,
  readRememberedAccent,
  rememberAccent,
} from "./accent.js";

/*
 * The accent catalogue is a mirror of two other sources of truth: the
 * server's VALID_ACCENT_COLORS (which backs a CHECK constraint on
 * settings.accent_color) and the `:root[data-accent="…"]` blocks in the
 * stylesheet. The module header says renaming a key desyncs validation
 * — the parity blocks below turn that warning into a failing test.
 */

beforeEach(() => {
  document.documentElement.removeAttribute("data-accent");
});

describe("catalogue integrity", () => {
  it("has no duplicate names", () => {
    const names = ACCENTS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes the default accent", () => {
    expect(ACCENTS.map((a) => a.name)).toContain(DEFAULT_ACCENT);
  });

  it("gives every accent a name, kanji, label, swatch and description", () => {
    for (const a of ACCENTS) {
      expect(a.name).toMatch(/^[a-z]+$/);
      expect(a.kanji, a.name).toBeTruthy();
      expect(a.label, a.name).toBeTruthy();
      expect(a.swatch, a.name).toMatch(/^oklch\(/);
      expect(a.description, a.name).toBeTruthy();
    }
  });
});

describe("applyAccentToDocument", () => {
  it("sets data-accent for a non-default accent", () => {
    applyAccentToDocument("kin");
    expect(document.documentElement.getAttribute("data-accent")).toBe("kin");
  });

  it("clears the attribute for the default accent", () => {
    // shu's tokens already live on `:root`, so the attribute would be
    // a no-op at best and a specificity trap at worst.
    applyAccentToDocument("kin");
    applyAccentToDocument(DEFAULT_ACCENT);
    expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
  });

  it.each([[null], [undefined], [""], ["not-an-accent"], ["KIN"]])(
    "clears the attribute for %p rather than writing a bogus value",
    (input) => {
      applyAccentToDocument("kin");
      applyAccentToDocument(input);
      expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
    },
  );

  it("accepts every accent in the catalogue", () => {
    for (const a of ACCENTS.filter((x) => x.name !== DEFAULT_ACCENT)) {
      applyAccentToDocument(a.name);
      expect(document.documentElement.getAttribute("data-accent"), a.name).toBe(a.name);
    }
  });

  it("replaces a previously applied accent rather than stacking", () => {
    applyAccentToDocument("kin");
    applyAccentToDocument("ai");
    expect(document.documentElement.getAttribute("data-accent")).toBe("ai");
  });
});

describe("storage", () => {
  it("reports nothing remembered on a fresh install", () => {
    expect(readRememberedAccent()).toBeNull();
  });

  it("round-trips an accent", () => {
    rememberAccent("moegi");
    expect(readRememberedAccent()).toBe("moegi");
  });

  it.each([[null], [undefined], [""]])("clears the stored accent for %p", (input) => {
    rememberAccent("moegi");
    rememberAccent(input);
    expect(readRememberedAccent()).toBeNull();
  });

  it("does not throw when localStorage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => rememberAccent("kin")).not.toThrow();
  });

  it("returns null rather than throwing when localStorage is unreadable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readRememberedAccent()).toBeNull();
  });
});

describe("bootstrapAccentFromStorage", () => {
  it("applies the remembered accent on cold start", () => {
    rememberAccent("murasaki");
    bootstrapAccentFromStorage();
    expect(document.documentElement.getAttribute("data-accent")).toBe("murasaki");
  });

  it("leaves the document alone when nothing was remembered", () => {
    bootstrapAccentFromStorage();
    expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
  });

  it("ignores a remembered value that is no longer in the catalogue", () => {
    // A downgrade, or an accent removed from the catalogue, must not
    // paint an attribute the stylesheet has no block for.
    localStorage.setItem("mc:accent", "retired-accent");
    bootstrapAccentFromStorage();
    expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
  });
});

describe("parity with the server", () => {
  const SETTINGS_RS = path.resolve(
    import.meta.dirname,
    "../../../server/src/services/settings.rs",
  );
  const available = existsSync(SETTINGS_RS);

  it.runIf(available)("declares exactly VALID_ACCENT_COLORS, in the same order", () => {
    const src = readFileSync(SETTINGS_RS, "utf8");
    const block = src.match(/VALID_ACCENT_COLORS[^=]*=\s*&\[([^\]]+)\]/);
    expect(block, "VALID_ACCENT_COLORS not found in settings.rs").toBeTruthy();
    const serverNames = [...block[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(serverNames.length).toBeGreaterThan(0);
    expect(ACCENTS.map((a) => a.name)).toEqual(serverNames);
  });
});

describe("parity with the stylesheet", () => {
  const STYLES_DIR = path.resolve(import.meta.dirname, "../styles");
  const available = existsSync(STYLES_DIR);

  it.runIf(available)("has a data-accent block for every non-default accent", () => {
    const css = readdirSync(STYLES_DIR)
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFileSync(path.join(STYLES_DIR, f), "utf8"))
      .join("\n");
    const declared = new Set(
      [...css.matchAll(/data-accent="([a-z]+)"/g)].map((m) => m[1]),
    );
    for (const a of ACCENTS) {
      // The default's tokens live on bare `:root`, so it deliberately
      // has no `[data-accent]` block of its own.
      if (a.name === DEFAULT_ACCENT) continue;
      expect(declared, `no [data-accent="${a.name}"] block in the stylesheet`).toContain(
        a.name,
      );
    }
  });
});
