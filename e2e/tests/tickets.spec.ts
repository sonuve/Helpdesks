import { test, expect } from "@playwright/test";
import { AGENT_STORAGE_STATE } from "../fixtures/storage-state.ts";
import { createTicketViaIngest } from "../fixtures/tickets.ts";

// TicketsPage/TicketsTable (client/src/pages/TicketsPage.tsx,
// TicketsTable.tsx) and TicketDetailPage (client/src/pages/
// TicketDetailPage.tsx, plus its TicketDetails/ReplyThread/ReplyForm/
// UpdateTicket sub-components) — both routed under ProtectedRoute in
// App.tsx, same as "/" and "/users".
//
// Per CLAUDE.md's testing-strategy doc, this file deliberately does NOT
// re-cover what's already exercised by component tests: sort/filter/
// pagination params (TicketsTable.test.tsx), loading skeletons
// (TicketDetailsSkeleton.test.tsx), form validation and mutation request
// bodies (ReplyForm.test.tsx, UpdateTicket.test.tsx), or reply-thread
// rendering (ReplyThread.test.tsx). It only covers what genuinely needs a
// real browser and a real server/DB round trip: seeding a ticket through
// the actual ingestion endpoint, then getting to it via real client-side
// routing (a list-row Link click) and a real direct navigation, and
// confirming the right ticket's data is what actually renders.
//
// Unauthenticated-redirect behavior for a ProtectedRoute page is already
// covered generically by route-guards.spec.ts (for "/" and "/users",
// which share the exact same ProtectedRoute component /tickets and
// /tickets/:id are also wrapped in) — not duplicated here per-route.
//
// Pre-authenticated via AGENT_STORAGE_STATE (see tests/auth.setup.ts):
// every ticket endpoint is req.user-only with no role check
// (project-scope.md's "Agent permissions" decision), so a non-admin agent
// is the right fixture identity, and this doesn't touch the shared
// sign-in rate limit budget.

test.describe("tickets list and detail", () => {
  test.use({ storageState: AGENT_STORAGE_STATE });

  test("a newly ingested ticket appears in the list and opens on its detail page via the subject link", async ({
    page,
    request,
  }) => {
    const ticket = await createTicketViaIngest(request);

    await page.goto("/tickets");
    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();

    // Default sort is createdAt desc (TicketsTable.tsx) and this spec file
    // is the only place in the suite that creates Ticket rows, so the
    // ticket just seeded is among the most recent and lands on page 1
    // regardless of how much data earlier suite runs left in
    // helpdesk_test.
    const row = page.getByRole("row", { name: new RegExp(ticket.subject) });
    await expect(row).toBeVisible();
    await expect(row.getByText(ticket.requesterEmail)).toBeVisible();

    await row.getByRole("link", { name: ticket.subject }).click();

    // Real client-side navigation actually happened, not just a visual
    // change.
    await expect(page).toHaveURL(`/tickets/${ticket.id}`);

    // The detail page loaded this exact ticket's data from the server,
    // not stale/cached data from the list.
    await expect(page.getByText(ticket.subject)).toBeVisible();
    await expect(page.getByText(ticket.requesterEmail)).toBeVisible();
    await expect(page.getByText(ticket.body)).toBeVisible();
    // A freshly ingested ticket has no assignment/replies yet — confirms
    // the detail view reflects real server state, not a stale fixture.
    await expect(page.getByText("No replies yet.")).toBeVisible();
  });

  test("navigating directly to /tickets/:id resolves the right ticket", async ({
    page,
    request,
  }) => {
    const ticket = await createTicketViaIngest(request);

    // A direct (hard) navigation to a nested route, not a client-side
    // Link click from the list — this only proves anything with a real
    // browser hitting the real dev server (SPA fallback serving
    // index.html for this deep path, then react-router resolving
    // :id from the URL itself).
    await page.goto(`/tickets/${ticket.id}`);

    await expect(page.getByText(ticket.subject)).toBeVisible();
    await expect(page.getByText(ticket.body)).toBeVisible();

    await page.getByRole("link", { name: "Back to tickets" }).click();
    await expect(page).toHaveURL("/tickets");
  });
});
