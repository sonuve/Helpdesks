import { test, expect } from "@playwright/test";
import { AGENT_USER, UNVERIFIED_USER, WRONG_PASSWORD } from "../fixtures/users.ts";
import { resetRateLimit } from "../fixtures/db.ts";

// Two server-side sign-in gates from server/src/lib/auth.ts that both drive
// real POST /sign-in/email requests and therefore compete for the shared
// 3-requests/10s sign-in rate limit budget:
//
//   - requireEmailVerification: true
//   - the built-in sign-in rate limiter itself
//
// This file runs as its own Playwright project ("auth-security" in
// playwright.config.ts) with `dependencies: ["chromium"]`, so it only
// starts once every other real sign-in in the suite (login.spec.ts,
// admin-access.spec.ts's sign-out test, tests/auth.setup.ts) has already
// finished — nothing else can be mid-flight against the same IP-keyed
// bucket. Within the file, both tests run in one serial block (a single
// worker, in order) so they can't race each other either: each test resets
// the rate_limit table for itself immediately before spending its own
// budget.
test.describe.configure({ mode: "serial" });

test.describe("requireEmailVerification (server/src/lib/auth.ts)", () => {
  test.beforeAll(async () => {
    await resetRateLimit();
  });

  test("an unverified account cannot sign in even with the correct password", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(UNVERIFIED_USER.email);
    await page.getByLabel("Password").fill(UNVERIFIED_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // better-auth rejects with BASE_ERROR_CODES.EMAIL_NOT_VERIFIED
    // ("Email not verified") only after the password check passes, so this
    // specifically exercises the verification gate, not just bad
    // credentials.
    await expect(page.getByRole("alert")).toHaveText("Email not verified");
    await expect(page).toHaveURL("/login");
  });
});

test.describe("built-in sign-in rate limit (3 requests / 10s, server/src/lib/auth.ts)", () => {
  test.beforeAll(async () => {
    await resetRateLimit();
  });

  test("blocks sign-in after 3 attempts and surfaces it as an error in the UI", async ({
    page,
    request,
  }) => {
    // Spend the 3-request budget quickly and directly against the API
    // (deliberately wrong password, so no session is ever created) — the
    // rate limiter counts requests to the path regardless of outcome, so
    // this doesn't need to go through the slower UI form three times.
    for (let i = 0; i < 3; i++) {
      await request.post("/api/auth/sign-in/email", {
        data: { email: AGENT_USER.email, password: WRONG_PASSWORD },
      });
    }

    // The 4th attempt — this time through the real UI, with the *correct*
    // password — should still be blocked by the rate limiter rather than
    // signing in.
    await page.goto("/login");
    await page.getByLabel("Email").fill(AGENT_USER.email);
    await page.getByLabel("Password").fill(AGENT_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toHaveText("Too many requests. Please try again later.");
    await expect(page).toHaveURL("/login");
  });
});
