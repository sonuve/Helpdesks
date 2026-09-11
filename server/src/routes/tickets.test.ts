import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { Role } from "core";
import supertest from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

// POST /api/tickets (the email-to-ticket ingestion webhook): pure
// request/validation/response-shape logic with no browser involved, so
// this runs against the Express app in-process via supertest rather than
// through the full Playwright e2e harness (browser + webServer + Vite
// proxy) — see CLAUDE.md's "Server testing" section. Run against
// server/.env.test's helpdesk_test database (bun --env-file=.env.test
// test, per package.json), same database the e2e suite uses, but without
// spinning up a browser or the client dev server.
const request = supertest(app);

const INGEST_SECRET = process.env.EMAIL_INGEST_SECRET;
if (!INGEST_SECRET) {
  throw new Error(
    "EMAIL_INGEST_SECRET is not set — expected `bun --env-file=.env.test test` to have loaded it.",
  );
}

// Tests that create a real ticket track the id so afterAll can clean up —
// unlike the e2e database, this one doesn't just accumulate rows run over
// run.
const createdTicketIds: number[] = [];

afterAll(async () => {
  if (createdTicketIds.length > 0) {
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
  }
  await prisma.$disconnect();
});

describe("POST /api/tickets", () => {
  test("401s with no x-ingest-secret header", async () => {
    const res = await request
      .post("/api/tickets")
      .send({ from: "customer@example.com", subject: "Help", body: "Something is broken." });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  test("401s with a wrong x-ingest-secret header", async () => {
    const res = await request
      .post("/api/tickets")
      .set("x-ingest-secret", "definitely-not-the-secret")
      .send({ from: "customer@example.com", subject: "Help", body: "Something is broken." });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  test("400s with the zod message when `from` is not a valid email", async () => {
    const res = await request
      .post("/api/tickets")
      .set("x-ingest-secret", INGEST_SECRET)
      .send({ from: "not-an-email", subject: "Help", body: "Something is broken." });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A valid sender email is required" });
  });

  test("201s and creates a ticket for a valid request", async () => {
    const subject = `Server test ingestion ${Date.now()}`;
    const res = await request
      .post("/api/tickets")
      .set("x-ingest-secret", INGEST_SECRET)
      .send({ from: "Customer@Example.com", subject, body: "My printer is on fire." });

    expect(res.status).toBe(201);
    createdTicketIds.push(res.body.ticket.id);
    expect(res.body.ticket).toMatchObject({
      status: "OPEN",
      category: null,
      subject,
      body: "My printer is on fire.",
      // Stored lowercased regardless of the casing the sender used.
      requesterEmail: "customer@example.com",
    });
    expect(typeof res.body.ticket.id).toBe("number");
    expect(typeof res.body.ticket.createdAt).toBe("string");
  });

  test('falls back to "(no subject)" when subject is omitted', async () => {
    const body = `Server test ingestion no-subject ${Date.now()}`;
    const res = await request
      .post("/api/tickets")
      .set("x-ingest-secret", INGEST_SECRET)
      .send({ from: "customer@example.com", body });

    expect(res.status).toBe(201);
    createdTicketIds.push(res.body.ticket.id);
    expect(res.body.ticket.subject).toBe("(no subject)");
    expect(res.body.ticket.body).toBe(body);
  });
});

describe("GET /api/tickets", () => {
  test("401s when unauthenticated", async () => {
    const res = await request.get("/api/tickets");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  test("400s for a sortBy outside the allow-list", async () => {
    // Doesn't need auth — the query is validated before req.user is even
    // relevant... except it isn't: the auth check runs first (see
    // routes/tickets.ts), so an invalid sortBy from an unauthenticated
    // caller still 401s, not 400s. Confirm that ordering explicitly.
    const res = await request.get("/api/tickets?sortBy=password");
    expect(res.status).toBe(401);
  });

  // Sorting is real Prisma orderBy, which needs an authenticated request
  // to reach — everything below shares one signed-in session (one sign-in
  // call) rather than one per test, since sign-in shares the same
  // IP-keyed rate-limit bucket the e2e suite's real sign-ins use (see
  // CLAUDE.md's "Rate limiting").
  describe("as an authenticated user", () => {
    const agent = supertest.agent(app);
    const userEmail = `server-test-tickets-${Date.now()}@example.com`;
    const userPassword = "Server-Test-Passw0rd!";
    let userId: string;
    const ticketIds: number[] = [];

    beforeAll(async () => {
      userId = crypto.randomUUID();
      const now = new Date();
      await prisma.user.create({
        data: {
          id: userId,
          name: "Server Test Agent",
          email: userEmail,
          // Trusted directly rather than going through the verification
          // email flow — this user exists only to authenticate these
          // requests, not to exercise sign-up/verification.
          emailVerified: true,
          role: Role.AGENT,
          createdAt: now,
          updatedAt: now,
          accounts: {
            create: {
              id: crypto.randomUUID(),
              accountId: userId,
              providerId: "credential",
              password: await hashPassword(userPassword),
              createdAt: now,
              updatedAt: now,
            },
          },
        },
      });

      const signIn = await agent
        .post("/api/auth/sign-in/email")
        .send({ email: userEmail, password: userPassword });
      if (signIn.status !== 200) {
        throw new Error(`Test setup sign-in failed: ${signIn.status} ${JSON.stringify(signIn.body)}`);
      }

      // Three tickets whose subject/createdAt orders disagree, so a test
      // asserting "sorted by subject" can't accidentally pass because it
      // also happens to match creation order. createdAt is set explicitly
      // (1s apart) rather than left to real-clock `new Date()` per
      // iteration — a tight loop can produce identical millisecond
      // timestamps, which would make "newest first" ties undefined. Each
      // also gets a distinct status/category so filtering tests below have
      // something to actually distinguish.
      const baseTime = Date.now();
      const fixtures = [
        { subject: "Charlie", status: "OPEN" as const, category: "GENERAL_QUESTION" as const },
        { subject: "Alpha", status: "RESOLVED" as const, category: "TECHNICAL_QUESTION" as const },
        { subject: "Bravo", status: "CLOSED" as const, category: null },
      ];
      for (let i = 0; i < fixtures.length; i++) {
        const fixture = fixtures[i]!;
        const timestamp = new Date(baseTime + i * 1000);
        const ticket = await prisma.ticket.create({
          data: {
            subject: fixture.subject,
            status: fixture.status,
            category: fixture.category,
            body: "sorting/filtering fixture",
            requesterEmail: "sort-fixture@example.com",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });
        ticketIds.push(ticket.id);
      }
    });

    afterAll(async () => {
      await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.account.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    });

    test("defaults to createdAt desc (newest first) with no query params", async () => {
      const res = await agent.get("/api/tickets");

      expect(res.status).toBe(200);
      const ids = (res.body.tickets as { id: number }[]).map((t) => t.id);
      // Fixture tickets were created Charlie, Alpha, Bravo in that order —
      // newest-first is the reverse of that.
      const [charlie, alpha, bravo] = ticketIds as [number, number, number];
      expect(ids.indexOf(bravo)).toBeLessThan(ids.indexOf(alpha));
      expect(ids.indexOf(alpha)).toBeLessThan(ids.indexOf(charlie));
    });

    test("sorts by subject ascending when asked", async () => {
      const res = await agent.get("/api/tickets?sortBy=subject&sortOrder=asc");

      expect(res.status).toBe(200);
      const ours = (res.body.tickets as { id: number; subject: string }[]).filter((t) =>
        ticketIds.includes(t.id),
      );
      expect(ours.map((t) => t.subject)).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    test("sorts by subject descending when asked", async () => {
      const res = await agent.get("/api/tickets?sortBy=subject&sortOrder=desc");

      expect(res.status).toBe(200);
      const ours = (res.body.tickets as { id: number; subject: string }[]).filter((t) =>
        ticketIds.includes(t.id),
      );
      expect(ours.map((t) => t.subject)).toEqual(["Charlie", "Bravo", "Alpha"]);
    });

    test("filters by status", async () => {
      const res = await agent.get("/api/tickets?status=RESOLVED");

      expect(res.status).toBe(200);
      const ours = (res.body.tickets as { id: number; subject: string }[]).filter((t) =>
        ticketIds.includes(t.id),
      );
      expect(ours.map((t) => t.subject)).toEqual(["Alpha"]);
    });

    test("filters by category", async () => {
      const res = await agent.get("/api/tickets?category=GENERAL_QUESTION");

      expect(res.status).toBe(200);
      const ours = (res.body.tickets as { id: number; subject: string }[]).filter((t) =>
        ticketIds.includes(t.id),
      );
      expect(ours.map((t) => t.subject)).toEqual(["Charlie"]);
    });

    test("filters by the UNCLASSIFIED sentinel to find tickets with no category", async () => {
      const res = await agent.get("/api/tickets?category=UNCLASSIFIED");

      expect(res.status).toBe(200);
      const ours = (res.body.tickets as { id: number; subject: string }[]).filter((t) =>
        ticketIds.includes(t.id),
      );
      expect(ours.map((t) => t.subject)).toEqual(["Bravo"]);
    });

    test("combines status and category filters (AND, not OR)", async () => {
      const res = await agent.get("/api/tickets?status=OPEN&category=TECHNICAL_QUESTION");

      expect(res.status).toBe(200);
      const ours = (res.body.tickets as { id: number }[]).filter((t) => ticketIds.includes(t.id));
      // Charlie is OPEN but GENERAL_QUESTION; Alpha is TECHNICAL_QUESTION
      // but RESOLVED — neither matches both conditions at once.
      expect(ours).toEqual([]);
    });

    test("400s for a status outside TicketStatus", async () => {
      const res = await agent.get("/api/tickets?status=ARCHIVED");
      expect(res.status).toBe(400);
    });

    test("400s for a category that's neither TicketCategory nor UNCLASSIFIED", async () => {
      const res = await agent.get("/api/tickets?category=NOT_A_REAL_CATEGORY");
      expect(res.status).toBe(400);
    });
  });
});
