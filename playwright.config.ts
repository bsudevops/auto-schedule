import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the demo data, on a production build.
 * Run: npm run build && npm run db:seed && npm run e2e (reseed before running again; the tests change the demo data).
 * Starts the app on localhost and the worker, both with dry-run publishing.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
// E2E_CRON=1 runs the Vercel way: no worker, publishing is done by the app itself and the cron routes.
const cron = process.env.E2E_CRON === "1";
const env = { GEMINI_API_KEY: "e2e-gemini-key", GEMINI_BASE_URL: "http://localhost:3999", PUBLISH_DRY_RUN: "true", SCHEDULER_INTERVAL_MS: "2000", APP_URL: `http://localhost:${PORT}`, BETTER_AUTH_URL: `http://localhost:${PORT}`, ...(cron ? { JOBS_MODE: "inline", CRON_SECRET: "e2e-cron-secret" } : {}) };

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "e2e/results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "e2e", testMatch: /\.spec\.ts/, dependencies: ["setup"], use: { storageState: "e2e/results/.auth.json" } },
  ],
  webServer: [
    { command: `npx next start -p ${PORT}`, url: `http://localhost:${PORT}/api/health`, timeout: 60_000, reuseExistingServer: !process.env.CI, env },
    // Stands in for the Gemini API, so "Write from media" can be tested without a key.
    { command: "node e2e/mock-gemini.mjs", port: 3999, timeout: 15_000, reuseExistingServer: true },
    // Serves uploaded files, so tests can play videos and read their frames.
    { command: "npm run media", port: 3001, timeout: 30_000, reuseExistingServer: true },
    ...(cron ? [] : [{ command: "npm run worker", wait: { stdout: /Worker ready/ }, timeout: 60_000, reuseExistingServer: false, env }]),
  ],
});
