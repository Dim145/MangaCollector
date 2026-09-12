import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/*
 * 試 · Test-only Vite config.
 *
 * Deliberately NOT reusing `vite.config.js`: that file mounts
 * `VitePWA` (with `devOptions.enabled`) and the i18n preload injector,
 * both of which want a real build pipeline and a `dist/` output. Under
 * Vitest they only add service-worker noise and slow every run down.
 *
 * What we do keep is the `@` alias — several modules under test import
 * siblings through it (`@/utils/axios.js`), so resolution has to match
 * the app build exactly or the imports fail at collection time.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.{test,spec}.{js,jsx}"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      // Scoped to the logic layer. The 112 components under
      // `src/components/` have no tests yet, and folding them in would
      // bury the numbers that mean something today under a single
      // low-single-digit percentage. Within utils/ and lib/ the report
      // is deliberately honest: untested modules show as 0% so the
      // remaining gaps stay visible rather than being defined away.
      include: ["src/utils/**", "src/lib/**"],
      exclude: ["src/**/*.{test,spec}.{js,jsx}", "src/test/**"],
    },
  },
});
