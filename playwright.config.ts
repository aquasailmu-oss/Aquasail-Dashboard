import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local keys for the service client used in assertions (never in the browser).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const baseURL =
  process.env.E2E_BASE_URL ??
  process.env.APP_BASE_URL ??
  (process.env.CI ? "http://localhost:3000" : "http://localhost:3100");
const port = new URL(baseURL).port || (baseURL.startsWith("https:") ? "443" : "80");
const startCommand = process.env.CI
  ? `npm run build && npm run start -- --port ${port}`
  : `npm run dev -- --port ${port}`;

/**
 * End-to-end tests (WP-20) against the seeded local stack: `npm run db:demo`
 * first. One worker per stack: tests share one database. CI shards the suite
 * across two runners, each with its own seeded Supabase stack. Locally a
 * running `npm run dev` is reused; CI builds and starts the app.
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
    baseURL,
    trace: "retain-on-failure",
    launchOptions: { args: ["--disable-dev-shm-usage"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: startCommand,
    url: new URL("/login", baseURL).toString(),
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
