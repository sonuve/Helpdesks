import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const serverDir = path.resolve(import.meta.dirname, "../server");
const clientDir = path.resolve(import.meta.dirname, "../client");

// NOTE: local `reuseExistingServer` reuses whatever is already listening on
// these ports — if you have `bun run dev` running against your normal dev
// database, stop it first, or these tests will run against dev data instead
// of the isolated helpdesk_test database. CI always starts fresh.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  globalSetup: "./global-setup.ts",

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },

  webServer: [
    {
      command: "bun --env-file=.env.test src/index.ts",
      cwd: serverDir,
      url: "http://localhost:3001/api/health",
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "bun run dev",
      cwd: clientDir,
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],

  projects: [
    // Signs in as each fixture role once via the real UI and saves the
    // session cookie as storageState (see tests/auth.setup.ts). Every
    // other project depends on this, so it always runs first and to
    // completion, keeping the shared sign-in rate limit budget predictable.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
});
