import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * The e2e suite is the source of accessibility evidence: keyboard flow,
 * screen-reader announcements, error focus, offline recovery, and the
 * two-session conflict scenarios. It runs against a production build so the
 * server behaves exactly as the native `npm run build` / `npm run start` path.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Reset + reseed the database, then serve the production build so tests are
    // deterministic and hermetic (no external services required).
    command: `npm run db:reset && npm run db:seed && npm run build && npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DATABASE_URL: "file:./e2e.db",
      NODE_ENV: "production",
    },
  },
});
