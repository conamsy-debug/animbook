/**
 * AnimBook E2E — Playwright configuration.
 *
 * Plain ESM (.mjs) so Next's typecheck + webpack don't try to import
 * @playwright/test (which ships as a dev-dep). The E2E suite lives
 * in `./e2e/*.spec.ts` and runs via `npx playwright test` once the
 * package is installed.
 *
 * Install:
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.ANIMBOOK_WEB_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: [
    {
      command: "echo 'API assumed running at http://localhost:4000'",
      url: "http://localhost:4000/api/health",
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: "echo 'Web assumed running at http://localhost:3000'",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 30_000
    }
  ]
});
