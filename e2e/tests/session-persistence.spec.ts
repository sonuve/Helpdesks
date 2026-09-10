import { test, expect } from "@playwright/test";
import { ADMIN_USER, AGENT_USER } from "../fixtures/users.ts";
import { ADMIN_STORAGE_STATE, AGENT_STORAGE_STATE } from "../fixtures/storage-state.ts";

// Confirms an authenticated session survives a full page reload/navigation
// via the better-auth session cookie, not just React Router / in-memory
// client state. authClient.useSession() (client/src/hooks/useAuth.ts) has
// no localStorage-backed cache in this app's auth-client.ts config, so a
// fresh load re-derives auth state purely from the session cookie sent
// with the request — this is what these tests exercise.
//
// Pre-authenticated via storageState (see tests/auth.setup.ts), so this
// file makes no real sign-in calls and doesn't touch the shared sign-in
// rate limit budget.

test.describe("session persistence across reload", () => {
  test.use({ storageState: AGENT_STORAGE_STATE });

  test("a full page reload on / keeps the user signed in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(AGENT_USER.name)).toBeVisible();

    await page.reload();

    // ProtectedRoute re-evaluates useAuth() from scratch after this
    // reload; still lands on / (not redirected to /login) and the
    // authenticated shell (NavBar) still renders.
    await expect(page).toHaveURL("/");
    await expect(page.getByText(AGENT_USER.name)).toBeVisible();
  });
});

test.describe("session persistence for an admin-gated route", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("reloading on /users keeps the admin authorized, not just the initial navigation", async ({
    page,
  }) => {
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

    await page.reload();

    // AdminRoute re-checks role from a freshly-fetched session on this
    // reload too — still on /users, not bounced to /.
    await expect(page).toHaveURL("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    // Scoped to the nav: the admin fixture is also a row in the users
    // table below (UsersTable lists every user, including the signed-in
    // admin themself), so an unscoped getByText(ADMIN_USER.name) is
    // ambiguous now that that table exists.
    await expect(page.getByRole("navigation").getByText(ADMIN_USER.name)).toBeVisible();
  });
});
