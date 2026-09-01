import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

export default [
  // =====================
  // FRONTEND (BROWSER + REACT)
  // =====================
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021
      }
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "@typescript-eslint": tseslint,
      "unused-imports": unusedImports
    },
    settings: {
      react: {
        version: "detect"
      }
    },
    rules: {
      // React 17+ JSX runtime (NO import React needed)
      "react/react-in-jsx-scope": "off",

      // Hooks safety
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Let TS handle vars
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",

      // Auto cleanup imports
      "unused-imports/no-unused-imports": "error"
    }
  },

  // =====================
  // NODE FILES (VITE CONFIG, ETC)
  // =====================
  {
    files: ["vite.config.ts", "*.config.{js,ts}"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  }
];
