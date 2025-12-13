import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "main.js",
      "dist/",
      "coverage/"
    ]
  },
  
  // 1. Basic JavaScript recommendations
  pluginJs.configs.recommended,
  
  // 2. TypeScript Type-Checked recommendations (Required for "Promises must be awaited")
  ...tseslint.configs.recommendedTypeChecked,
  
  // 3. Obsidian Recommended Config (Correct placement: Top-level, not inside 'rules')
  ...obsidianmd.configs.recommended,

  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Restore your preferences
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "args": "none" }],
      "@typescript-eslint/ban-ts-comment": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-empty-function": "off",

      // Explicitly allow 'any' if you want (Note: The bot complains if you disable this rule using comments, 
      // but globally disabling it here might hide errors locally that the bot will see)
      // "@typescript-eslint/no-explicit-any": "off", 
    },
  },
  {
    // Disable type-checked rules for JS files to avoid parser errors
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: "module",
      globals: globals.browser
    },
  }
);