import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build in Sample data mode with its own database.
 *   pnpm build && pnpm test:e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);
const BASE = `http://localhost:${PORT}`;
const DB = process.env.E2E_DATABASE_URL ?? "postgres://leadfinder:leadfinder@localhost:5432/leadfinder_e2e";
const env = {
  APP_ENV: "development",
  APP_URL: BASE,
  DATABASE_URL: DB,
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-012345",
  SIGNUP_MODE: "approval",
  GOOGLE_MAPS_API_KEY: "",
  AI_GATEWAY_API_KEY: "",
  EXPORT_STORAGE_DIR: "./storage/e2e-exports",
  NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next",
  E2E_PORT: String(PORT),
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "off",
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "pnpm tsx e2e/start-stack.ts",
    url: `${BASE}/sign-in`,
    reuseExistingServer: false,
    timeout: 180_000,
    env,
  },
});
