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
  reporter: [["html", { outputFolder: path.resolve(import.meta.dirname, "playwright-report") }]],
  // Pinned to an absolute path anchored at this config file rather than
  // left as Playwright's relative-path default, which resolves against
  // whatever process's cwd actually invoked `playwright test` — that's
  // e2e/ for `bun run test:e2e`, but not necessarily true for every
  // runner (e.g. the VS Code Playwright extension, or a bare `npx
  // playwright test --config=e2e/playwright.config.ts` from the repo
  // root). Pinning both this and the HTML reporter's outputFolder above
  // keeps test-results/ and playwright-report/ under e2e/ no matter how
  // the suite is launched.
  outputDir: path.resolve(import.meta.dirname, "test-results"),
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
      testIgnore: [/auth\.setup\.ts/, /auth-security\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    // tests/auth-security.spec.ts deliberately exhausts the shared sign-in
    // rate limit budget (and separately signs in with an unverified
    // account) — both are real /sign-in/email calls sharing the same
    // IP-keyed bucket every other spec's real sign-ins use. Running it as
    // its own project that depends on "chromium" guarantees every other
    // real sign-in in the suite has already finished before this starts,
    // so it can't starve them (or be starved/raced by them). See the
    // comment at the top of that file for the rest of the reasoning.
    {
      name: "auth-security",
      testMatch: /auth-security\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["chromium"],
    },
  ],
});
