import type { APIRequestContext } from "@playwright/test";

// Seeds a Ticket the same way a real one gets created today: a POST to the
// "email ingestion" webhook endpoint (server/src/routes/tickets.ts),
// gated by the shared EMAIL_INGEST_SECRET header rather than session auth.
// This is deliberately not a direct Prisma insert — going through the real
// endpoint exercises the actual code path (and is exactly the kind of
// real client/server round trip e2e should cover per CLAUDE.md's testing
// strategy doc), and the endpoint's shape (`{ from, subject?, body }`,
// always created OPEN/unclassified/unassigned with no replies) is all
// tests/tickets.spec.ts needs — category/assignment/reply-thread display
// logic itself is already covered by component tests
// (TicketDetails.test.tsx, UpdateTicket.test.tsx, ReplyThread.test.tsx).
//
// EMAIL_INGEST_SECRET must be on process.env, which it is here for the
// same reason DATABASE_URL is available to fixtures/db.ts:
// e2e/global-setup.ts loads server/.env.test via dotenv into the main
// Playwright process before workers (and the spec files they run) fork
// from it.
export async function createTicketViaIngest(
  request: APIRequestContext,
  overrides: { from?: string; subject?: string; body?: string } = {},
) {
  const secret = process.env.EMAIL_INGEST_SECRET;
  if (!secret) {
    throw new Error(
      "EMAIL_INGEST_SECRET is not set on process.env — check server/.env.test and that " +
        "e2e/global-setup.ts's dotenv load ran before this test.",
    );
  }

  // Unique per call so a fresh ticket is trivially the most recent row in
  // helpdesk_test (TicketsTable.tsx's default sort is createdAt desc) no
  // matter how much data past suite runs have left behind, and so its
  // subject can be matched unambiguously in the UI.
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const res = await request.post("/api/tickets", {
    headers: { "x-ingest-secret": secret },
    data: {
      from: overrides.from ?? `e2e-ticket-${unique}@example.com`,
      subject: overrides.subject ?? `E2E ticket ${unique}`,
      body: overrides.body ?? `E2E-seeded ticket body ${unique}.`,
    },
  });

  if (!res.ok()) {
    throw new Error(
      `Failed to seed a ticket via POST /api/tickets: ${res.status()} ${await res.text()}`,
    );
  }

  const { ticket } = (await res.json()) as {
    ticket: { id: number; subject: string; requesterEmail: string; body: string };
  };
  return ticket;
}
