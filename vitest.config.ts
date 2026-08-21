import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Komponenten-Tests (2026-08-21): .jsx-Module nutzen das automatische
  // JSX-Runtime (kein React-Import) — wie im App-Build via @vitejs/plugin-react.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
  },
});
