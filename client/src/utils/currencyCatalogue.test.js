import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The set of currencies lives in four places that nothing links at
 * compile time:
 *
 *   server/src/services/settings.rs      get_currency_by_code (the truth)
 *   server/migrations/*settings_currency* the CHECK constraint on the column
 *   client/.../ChapterContent.jsx         the picker's CURRENCIES
 *   client/.../SettingsPage.jsx           CURRENCY_FORMATS, the optimistic mirror
 *
 * Adding a code to one and forgetting another fails quietly: a picker
 * button whose save the database rejects, or a server code with no
 * button. This reads the four files and fails when they disagree.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const serverCodes = [
  ...read("server/src/services/settings.rs").matchAll(
    /"([A-Z]{3})"\s*=>\s*Some\(CurrencyInfo/g,
  ),
].map((m) => m[1]);

const pickerCodes = [
  ...read("client/src/components/settings/ChapterContent.jsx").matchAll(
    /\{\s*code:\s*"([A-Z]{3})",\s*key:/g,
  ),
].map((m) => m[1]);

const mirrorCodes = [
  ...read("client/src/components/SettingsPage.jsx").matchAll(
    /^\s{2}([A-Z]{3}):\s*\{\s*code:\s*"\1"/gm,
  ),
].map((m) => m[1]);

// The constraint as the newest migration that sets it leaves it.
import { readdirSync } from "node:fs";
const migrations = readdirSync(resolve(root, "server/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
let constraintCodes = [];
for (const f of migrations) {
  const sql = read(`server/migrations/${f}`);
  const m = sql.match(/currency[^\n]*IN\s*\(([^)]*)\)/i);
  if (m && /settings/i.test(sql)) {
    constraintCodes = [...m[1].matchAll(/'([A-Z]{3})'/g)].map((x) => x[1]);
  }
}

describe("currency catalogue", () => {
  it("finds the codes in every place (the scan itself works)", () => {
    expect(serverCodes.length).toBeGreaterThanOrEqual(3);
    expect(pickerCodes.length).toBeGreaterThanOrEqual(3);
    expect(mirrorCodes.length).toBeGreaterThanOrEqual(3);
    expect(constraintCodes.length).toBeGreaterThanOrEqual(3);
  });

  it("offers JPY everywhere", () => {
    for (const where of [serverCodes, pickerCodes, mirrorCodes, constraintCodes]) {
      expect(where).toContain("JPY");
    }
  });

  it("keeps the picker, the optimistic mirror and the database constraint in step with the server", () => {
    const sorted = (a) => [...a].sort();
    expect(sorted(pickerCodes)).toEqual(sorted(serverCodes));
    expect(sorted(mirrorCodes)).toEqual(sorted(serverCodes));
    expect(sorted(constraintCodes)).toEqual(sorted(serverCodes));
  });
});
