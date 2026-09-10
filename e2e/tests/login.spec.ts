import { test, expect } from "@playwright/test";
import { ADMIN_USER, AGENT_USER, WRONG_PASSWORD } from "../fixtures/users.ts";
import { resetRateLimit } from "../fixtures/db.ts";

// LoginPage (client/src/pages/LoginPage.tsx): zod-validated email/password
// form that calls authClient.signIn.email. This file is the only place in
// the suite that drives the real sign-in flow through the UI — every other
// spec starts pre-authenticated via storageState (see tests/auth.setup.ts)
// specifically to avoid tripping better-auth's 3-requests/10s sign-in rate
// limit. Reset the shared rate limit counters right before these tests so
// this file always gets a fresh budget regardless of what the "setup"
// project (or a previous run) already spent.
test.describe("login", () => {
  test.beforeAll(async () => {
    await resetRateLimit();
  });

  test("shows validation errors for empty fields", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Email is required")).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();
  });

  test("shows a validation error for a malformed email", async ({ page }) => {
    await page.goto("/login");
    // Must satisfy the <input type="email"> native constraint (roughly
    // "text@text", no dot required) so the browser lets the form submit at
    // all — otherwise the native validation bubble blocks submission
    // before React/zod ever sees it. Zod's stricter emailRegex (which
    // requires a dotted TLD) still rejects this, so LoginPage's own
    // "Enter a valid email address" message is the one that renders.
    await page.getByLabel("Email").fill("test@test");
    await page.getByLabel("Password").fill("something");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Enter a valid email address")).toBeVisible();
  });

  test("shows an error banner on a failed sign-in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_USER.email);
    await page.getByLabel("Password").fill(WRONG_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    // Stays on the login page rather than redirecting.
    await expect(page).toHaveURL("/login");
  });

  test("signs in with valid credentials and reaches the home page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(AGENT_USER.email);
    await page.getByLabel("Password").fill(AGENT_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Helpdesks" })).toBeVisible();
    // HomePage fetches /api/health on mount and renders the result.
    await expect(page.getByText(/API status: ok/i)).toBeVisible();
    // NavBar renders for the authenticated shell.
    await expect(page.getByText(AGENT_USER.name)).toBeVisible();
  });
});
