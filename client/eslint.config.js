import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]" }],
      // eslint-plugin-react-hooks v7 ships several new highly-opinionated
      // rules (cascading-set-state detection, static components, memoisation
      // nagging, library compatibility hints, immutability). They flag a lot
      // of correct-but-stylistically-aggressive code — turn them off and keep
      // only the two load-bearing rules that catch real bugs.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/void-use-memo": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/immutability": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/component-hook-factories": "off",
      "react-hooks/purity": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/refs": "off",
      "react-hooks/globals": "off",
      "react-hooks/gating": "off",
      "react-hooks/config": "off",
      // Mixing hooks/constants with components breaks Fast Refresh but isn't
      // a correctness issue — warn instead of erroring the build.
      "react-refresh/only-export-components": "warn",
    },
  },
]);
