import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local keys for the service client used in assertions (never in the browser).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/**
 * End-to-end tests (WP-20) against the seeded local stack: `npm run db:demo`
 * first. One worker: the tests share one database. Locally a running
 * `npm run dev` is reused; CI builds and starts the app.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions: { args: ["--disable-dev-shm-usage"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
