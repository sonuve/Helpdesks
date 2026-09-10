import { test, expect } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "../fixtures/storage-state.ts";

// Admin user-management CRUD (client/src/pages/UsersPage.tsx and friends):
// CreateUserDialog -> UsersTable -> EditUserDialog -> DeleteUserDialog. One
// end-to-end flow rather than four independent specs, since update/delete
// need a user that create already made.
//
// Pre-authenticated via ADMIN_STORAGE_STATE (see tests/auth.setup.ts), so
// this doesn't touch the shared sign-in rate limit budget.
//
// The user this test creates gets a per-run-unique email (Date.now()-based)
// rather than a fixed one: email has a DB-level unique constraint that a
// soft delete does not free up, so a fixed email would 409 on create the
// second time this suite runs against a database that still has the first
// run's soft-deleted row.

test.describe("admin user management", () => {
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("create, update, and delete a user", async ({ page }) => {
    const unique = Date.now();
    const name = `E2E CRUD User ${unique}`;
    const email = `e2e-crud-${unique}@example.com`;
    const updatedName = `E2E CRUD User ${unique} Updated`;

    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

    // --- Create ---
    await page.getByRole("button", { name: "New user" }).click();
    const createDialog = page.getByRole("dialog", { name: "Create user" });
    await expect(createDialog).toBeVisible();

    await createDialog.getByLabel("Name").fill(name);
    await createDialog.getByLabel("Email").fill(email);
    await createDialog.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Agent" }).click();
    await createDialog.getByLabel("Password").fill("E2eCrudUserPassw0rd!");
    await createDialog.getByRole("button", { name: "Create user" }).click();

    await expect(createDialog).toBeHidden();

    // --- Read ---
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText(email)).toBeVisible();
    await expect(row.getByText("Agent", { selector: "span" })).toBeVisible();

    // --- Update ---
    await row.getByRole("button", { name: `Edit ${name}` }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit user" });
    await expect(editDialog).toBeVisible();

    const nameInput = editDialog.getByLabel("Name");
    await nameInput.fill(updatedName);
    await editDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(editDialog).toBeHidden();

    // Row accessible names concatenate every cell's text, and updatedName
    // is name + " Updated" — a regex on the bare pre-update name would
    // still match this same row, so there's no meaningful separate "old
    // name is gone" check here beyond updatedRow itself being visible.
    const updatedRow = page.getByRole("row", { name: new RegExp(updatedName) });
    await expect(updatedRow).toBeVisible();

    // --- Delete ---
    await updatedRow.getByRole("button", { name: `Delete ${updatedName}` }).click();
    const deleteDialog = page.getByRole("alertdialog", { name: `Delete ${updatedName}?` });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Delete" }).click();

    await expect(deleteDialog).toBeHidden();
    await expect(page.getByRole("row", { name: new RegExp(updatedName) })).toHaveCount(0);
  });
});
