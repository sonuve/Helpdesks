import { test as setup, expect } from "@playwright/test";
import { ADMIN_USER, AGENT_USER, type TestUser } from "../fixtures/users.ts";
import { ADMIN_STORAGE_STATE, AGENT_STORAGE_STATE } from "../fixtures/storage-state.ts";

// Standard Playwright "auth setup project" pattern: sign in once per role
// through the real UI, then save the resulting session cookie as
// storageState so the rest of the suite can start already authenticated
// instead of re-running the sign-in flow (and consuming the shared
// sign-in rate limit budget) for every test that just needs to be logged
// in as an admin or agent. See playwright.config.ts's "setup" project and
// tests/login.spec.ts for the one place the real login flow itself is
// exercised.

async function signInAndSaveState(
  page: import("@playwright/test").Page,
  user: TestUser,
  storageStatePath: string,
) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/");
  // Wait for the authenticated shell (NavBar) to render, confirming the
  // session actually took, before snapshotting cookies.
  await expect(page.getByText(user.name)).toBeVisible();

  await page.context().storageState({ path: storageStatePath });
}

setup("authenticate as admin", async ({ page }) => {
  await signInAndSaveState(page, ADMIN_USER, ADMIN_STORAGE_STATE);
});

setup("authenticate as agent", async ({ page }) => {
  await signInAndSaveState(page, AGENT_USER, AGENT_STORAGE_STATE);
});
