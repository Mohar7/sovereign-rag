import { defineConfig, devices } from "@playwright/test";

// E2E config. Two suites:
//   tests/e2e/*.spec.ts   — playwright drives a real browser against a
//                            running Vite + LangGraph deployment.
//   tests/api/*.spec.ts   — playwright's request fixture talks to the
//                            LangGraph deployment directly (no browser).
//
// Both expect:
//   - LangGraph dev on http://127.0.0.1:2024 (passes via Vite proxy)
//   - Vite dev   on http://127.0.0.1:5173
// The `webServer` block boots Vite locally; for the Mac Mini run we point
// PLAYWRIGHT_BASE_URL at http://100.81.83.18:5173 and skip webServer.

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173";
const SKIP_WEBSERVER = !!process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: SKIP_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
