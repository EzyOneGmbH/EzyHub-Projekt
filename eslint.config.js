import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import react from "eslint-plugin-react";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      "supabase/functions/**",
      "src/routeTree.gen.ts",
      // Von Lovable regeneriert (supabase gen types, eigenes Format) — wie der
      // routeTree eine generierte Datei; Prettier-Zwang erzeugt sonst eine
      // endlose Format-Ping-Pong-Schleife mit dem Codegen (Befund 21.08.).
      "src/integrations/supabase/types.ts",
      // Scriptable-iOS-Widget: laeuft in der Scriptable-App mit eigenen
      // Globals (ListWidget, Color, Font, ...), nicht im Browser.
      "scripts/iphone-widget/**",
      // Vom mcpPlugin (@lovable.dev/mcp-js, vite.config) bei jedem Build
      // REGENERIERTE Routen-Dateien — der Codegen schreibt einzeilig und
      // kollidiert sonst dauerhaft mit Prettier.
      "src/routes/mcp.ts",
      "src/routes/\\[.mcp\\]/**",
      "src/routes/\\[.well-known\\]/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      react,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 21.08.: Core-no-undef prueft KEINE JSX-Tags — erst diese Regel fing
      // <Skeleton/>-artige Luecken nach der Modularisierung (Live-Crash).
      "react/jsx-no-undef": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // .jsx-Dateien (EzyOneApp & extrahierte Module): vor allem no-undef —
  // fehlende Imports nach Extraktionen sind sonst erst zur Laufzeit sichtbar.
  {
    extends: [js.configs.recommended],
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "react-hooks": reactHooks,
      react,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react/jsx-no-undef": "error",
      "no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  eslintPluginPrettier,
);
