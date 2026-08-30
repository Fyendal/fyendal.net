import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.config.{js,ts,mjs,mts}",
      "scripts/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Move fast: keep these as warnings, not blockers.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["apps/server/**", "packages/**"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/client/**"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["packages/cards/src/scripts/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@fyendal/engine/*"],
          message: "Card scripts may only use the public ScriptCtx type boundary.",
        }],
      }],
      "no-restricted-syntax": ["error",
        {
          selector: "ImportDeclaration[source.value='@fyendal/engine']:not([importKind='type'])",
          message: "Card scripts may import only types from @fyendal/engine; runtime behavior must use ScriptCtx.",
        },
        {
          selector: "CallExpression[callee.name='internal']",
          message: "Card scripts must mutate only through narrow ScriptCtx commands.",
        },
      ],
    },
  },
);
