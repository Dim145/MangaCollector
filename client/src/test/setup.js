import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

/*
 * Pin the timezone. Several suites assert on `toLocaleDateString`
 * output, and an ISO date without a time component is UTC midnight —
 * rendered a day earlier on any machine west of Greenwich. Fixing TZ
 * here means a test that passes in CI passes on a laptop in Paris and
 * one in Los Angeles.
 */
process.env.TZ = "UTC";

/*
 * Global test setup.
 *
 * `jsdom` gives each FILE a fresh window but shares it across the
 * tests inside that file, so `localStorage` leaks between cases
 * unless we clear it. Several modules under test (`lib/season.js`,
 * `lib/isbn.js`, `lib/theme.js`) persist through it, and a stale key
 * from an earlier test silently changes the next one's result.
 */
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});
