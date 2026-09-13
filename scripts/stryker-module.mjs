#!/usr/bin/env node
/**
 * 変 · Mutation-test one module against its own test file.
 *
 * The checked-in `client/stryker.conf.json` runs the whole suite for
 * every mutant, which is correct but costs sixteen seconds a mutant. A
 * module's own test file runs in two or three, so a focused campaign
 * finishes in a minute — which is the difference between a tool you
 * reach for and one you read about.
 *
 *   node scripts/stryker-module.mjs lib/loanHistory
 *   node scripts/stryker-module.mjs utils/volume lib/navCounters
 *   node scripts/stryker-module.mjs --all          # every paired module
 *
 * A module is "paired" when `src/<name>.js` and `src/<name>.test.js`
 * both exist. Anything else is a campaign with no tests to run, which
 * reports every mutant as survived and tells you nothing you did not
 * already know.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const CLIENT = new URL("../client/", import.meta.url).pathname;
const SRC = join(CLIENT, "src");

/** Every module that has a test file sitting next to it. */
function pairedModules() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".test.js")) {
        const module = full.replace(/\.test\.js$/, ".js");
        if (existsSync(module)) out.push(relative(SRC, module).replace(/\.js$/, ""));
      }
    }
  };
  for (const top of ["lib", "utils"]) walk(join(SRC, top));
  return out.sort();
}

function run(name) {
  const module = `src/${name}.js`;
  const test = `src/${name}.test.js`;
  if (!existsSync(join(CLIENT, module)) || !existsSync(join(CLIENT, test))) {
    console.error(`✗ ${name}: needs both ${module} and ${test}`);
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), "stryker-module-"));
  const config = join(dir, "stryker.json");
  writeFileSync(
    config,
    JSON.stringify(
      {
        packageManager: "pnpm",
        testRunner: "command",
        commandRunner: {
          command: `pnpm exec vitest run --config vitest.config.js ${test}`,
        },
        coverageAnalysis: "off",
        reporters: ["clear-text"],
        mutate: [module],
        concurrency: 4,
        timeoutMS: 30_000,
      },
      null,
      2,
    ),
  );
  const started = Date.now();
  const res = spawnSync("pnpm", ["exec", "stryker", "run", config], {
    cwd: CLIENT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  rmSync(dir, { recursive: true, force: true });
  const text = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const row = text.split("\n").find((l) => l.startsWith("All files"));
  const seconds = Math.round((Date.now() - started) / 1000);
  if (!row) {
    console.error(`✗ ${name}: no score — rerun on its own to see why`);
    if (process.env.STRYKER_MODULE_VERBOSE) console.error(text.slice(-2000));
    return null;
  }
  const [, score, , killed, , survived] = row.split("|").map((c) => c.trim());
  console.log(
    `${survived === "0" ? "✓" : "·"} ${name.padEnd(22)} ${score.padStart(6)}%  ` +
      `${killed.padStart(4)} killed  ${survived.padStart(3)} survived  ${seconds}s`,
  );
  // The clear-text reporter lists each survivor with its diff; keep them
  // so a campaign ends with something to act on.
  const survivors = text
    .split("\n")
    .filter((l) => l.startsWith("[Survived]"))
    .length;
  return { name, score: Number(score), killed: +killed, survived: +survived, survivors };
}

const args = process.argv.slice(2);
const names = args.includes("--all") ? pairedModules() : args;
if (names.length === 0) {
  console.error("usage: stryker-module.mjs <lib/foo|utils/bar>… | --all");
  process.exit(2);
}
const results = names.map(run).filter(Boolean);
if (results.length > 1) {
  const killed = results.reduce((n, r) => n + r.killed, 0);
  const survived = results.reduce((n, r) => n + r.survived, 0);
  const score = ((100 * killed) / (killed + survived)).toFixed(1);
  console.log(
    `\n${results.length} modules · ${killed} killed · ${survived} survived · ${score}%`,
  );
}
process.exit(results.some((r) => r.survived > 0) ? 1 : 0);
