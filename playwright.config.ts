// Playwright-E2E (QS-Runde 13.09.2026): laeuft gegen `vite dev` (Port E2E_PORT, Default 8093,
// Lovable-Preset) mit VOLLSTAENDIG gemocktem Netz (Supabase + /api) — kein
// Login, keine Secrets, keine Fremdsysteme. Siehe e2e/ezyai-ads.spec.ts.
import { defineConfig } from "@playwright/test";

const E2E_PORT = Number(process.env.E2E_PORT || 8093);

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Eigener Port (21.09.2026): Port 8080 war lokal von einem fremden Prozess
  // belegt (404 → Playwright wartete 180 s vergeblich). Dedizierter Port mit
  // strictPort, damit Vite nie stillschweigend ausweicht; Override via E2E_PORT.
  webServer: {
    command: `npx vite dev --port ${E2E_PORT} --strictPort`,
    url: `http://127.0.0.1:${E2E_PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
