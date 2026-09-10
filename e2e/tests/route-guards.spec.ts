import { test, expect } from "@playwright/test";
import { ADMIN_STORAGE_STATE, AGENT_STORAGE_STATE } from "../fixtures/storage-state.ts";

// GuestRoute / ProtectedRoute / AdminRoute (client/src/components/*.tsx).
// No real sign-in happens here — pre-authenticated state comes from
// storageState saved by tests/auth.setup.ts, so these tests don't touch
// the shared sign-in rate limit budget at all.

test.describe("unauthenticated", () => {
  // Default project storageState (none) — every context here starts logged
  // out.

  test("visiting / redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });

  test("visiting /users redirects to /login", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL("/login");
  });
});

test.describe("authenticated as agent (non-admin)", () => {
  test.use({ storageState: AGENT_STORAGE_STATE });

  test("visiting /login redirects to /", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL("/");
  });

  test("visiting /users redirects to /", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL("/");
  });
});

test.describe("authenticated as admin", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("visiting /login redirects to /", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL("/");
  });

  test("visiting /users shows the Users page", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });
});
