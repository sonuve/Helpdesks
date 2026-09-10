import { test, expect } from "@playwright/test";
import { ADMIN_USER, AGENT_USER } from "../fixtures/users.ts";
import { ADMIN_STORAGE_STATE, AGENT_STORAGE_STATE } from "../fixtures/storage-state.ts";
import { resetRateLimit } from "../fixtures/db.ts";

// NavBar (client/src/components/NavBar.tsx): role-gated "Users" link,
// signed-in user's name, and sign-out.
//
// The read-only tests below are pre-authenticated via storageState (see
// tests/auth.setup.ts) and don't touch the sign-in rate limit budget. The
// sign-out test deliberately does NOT reuse ADMIN_STORAGE_STATE: signing
// out invalidates that session server-side, and every other admin test in
// the suite reads the same saved session token concurrently
// (fullyParallel) — killing the shared token out from under them would be
// flaky. It logs in for itself instead, at the cost of one real sign-in
// call budgeted via resetRateLimit below.

test.describe("as admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("nav bar shows the Users link and the signed-in name", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText(ADMIN_USER.name)).toBeVisible();
    const usersLink = page.getByRole("link", { name: "Users" });
    await expect(usersLink).toBeVisible();

    await usersLink.click();
    await expect(page).toHaveURL("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });
});

test.describe("sign out", () => {
  test.beforeAll(async () => {
    await resetRateLimit();
  });

  test("clears the session and redirects to /login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_USER.email);
    await page.getByLabel("Password").fill(ADMIN_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");

    // Session is actually gone, not just a client-side navigation: reload
    // and confirm the guard still redirects here.
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });
});

test.describe("as agent (non-admin)", () => {
  test.use({ storageState: AGENT_STORAGE_STATE });

  test("nav bar hides the Users link but shows the signed-in name", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText(AGENT_USER.name)).toBeVisible();
    await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
  });
});
