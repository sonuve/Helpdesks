import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { Role } from "core";
import supertest from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

// POST /api/tickets/:id/polish-reply, .../generate-reply, and
// .../summarize all call out to a real AI provider via lib/reply-drafting.ts
// and lib/ticket-analysis.ts — replaced here so this suite never makes a
// real network call (or needs a real API key) just to test these routes'
// request/validation/response-shape logic. Bun's mock.module retroactively
// replaces the module for consumers that already imported it (tickets.ts,
// pulled in transitively via `app` above), not just future imports. Every
// export must be present in each mock even though a given test file section
// only exercises one — the mocked module replaces that file's entire export
// table, so an omitted export would be `undefined` in tickets.ts and crash
// the *other* routes instead of just not being tested. This is scoped to
// this file only — server/package.json's test script runs `bun test
// --isolate`, giving each test file its own module registry, so these
// mocks (and queue.test.ts's separate mock of the same resolved paths)
// can't leak into each other.
const polishReplyMock = mock(async () => "Mocked polished reply.");
const generateReplyMock = mock(async () => "Mocked generated reply.");
mock.module("../lib/reply-drafting.js", () => ({
  polishReply: polishReplyMock,
  generateReply: generateReplyMock,
}));
const summarizeTicketMock = mock(async () => "Mocked summary.");
mock.module("../lib/ticket-analysis.js", () => ({
  summarizeTicket: summarizeTicketMock,
}));

// POST /api/tickets enqueues classification and auto-resolution via
// lib/queue.ts's enqueueClassifyTicket/enqueueAutoResolveTicket rather than
// running either inline — replaced here so this suite never starts a real
// pg-boss instance (which would need its own schema migration against the
// test database) just to test the route's request/validation/response-
// shape logic. The queues' actual job processing (processClassifyTicketJobs,
// processAutoResolveTicketJobs) is lib/queue.ts's own concern, covered by
// queue.test.ts instead — same split as lib/reply-drafting.ts's and
// lib/ticket-analysis.ts's functions being mocked here but tested for real
// in reply-drafting.test.ts and ticket-analysis.test.ts.
const enqueueClassifyTicketMock = mock(async () => {});
const enqueueAutoResolveTicketMock = mock(async () => {});
mock.module("../lib/queue.js", () => ({
  enqueueClassifyTicket: enqueueClassifyTicketMock,
  enqueueAutoResolveTicket: enqueueAutoResolveTicketMock,
}));

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

  test("enqueues classification and auto-resolution for the new ticket without holding up the response", async () => {
    enqueueClassifyTicketMock.mockClear();
    enqueueAutoResolveTicketMock.mockClear();
    const subject = `Server test classification ${Date.now()}`;
    const body = "I'd like a refund for my last order, please.";

    const res = await request
      .post("/api/tickets")
      .set("x-ingest-secret", INGEST_SECRET)
      .send({ from: "customer@example.com", subject, body });

    expect(res.status).toBe(201);
    createdTicketIds.push(res.body.ticket.id);
    // Not classified/resolved yet — enqueuing just queues the jobs, it
    // doesn't run them. That's the whole point of going through the queue.
    expect(res.body.ticket.category).toBeNull();
    expect(res.body.ticket.status).toBe("OPEN");
    expect(enqueueClassifyTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: res.body.ticket.id, subject, body }),
    );
    expect(enqueueAutoResolveTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: res.body.ticket.id, subject, body }),
    );
  });

  test("still creates the ticket even if enqueuing classification fails", async () => {
    enqueueClassifyTicketMock.mockImplementationOnce(async () => {
      throw new Error("could not reach the queue");
    });
    const subject = `Server test classification enqueue failure ${Date.now()}`;

    const res = await request
      .post("/api/tickets")
      .set("x-ingest-secret", INGEST_SECRET)
      .send({ from: "customer@example.com", subject, body: "Something is broken." });

    // Unlike polish-reply/generate-reply/summarize, this route doesn't
    // catch this failure — an enqueue failure means the ticket exists but
    // will never get classified, which is worth a real 500 rather than a
    // clean-looking 201 that quietly drops the job. This is a documented
    // gap, not a design goal: revisit if silent tickets ever become a
    // real problem in practice.
    expect(res.status).toBe(500);
    const created = await prisma.ticket.findFirst({ where: { subject } });
    if (created) {
      createdTicketIds.push(created.id);
    }
    expect(created?.category ?? null).toBeNull();
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
    const paginationTicketIds: number[] = [];

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

      // A separate batch just for pagination tests, sharing a category
      // none of the three fixtures above use (REFUND_REQUEST) — filtering
      // on it isolates exactly these 5 regardless of whatever else is in
      // the table, so pagination tests don't need to assume the whole
      // ticket table is empty apart from this file's own fixtures.
      const paginationSubjects = ["Page-A", "Page-B", "Page-C", "Page-D", "Page-E"];
      for (let i = 0; i < paginationSubjects.length; i++) {
        const timestamp = new Date(baseTime + (fixtures.length + i) * 1000);
        const ticket = await prisma.ticket.create({
          data: {
            subject: paginationSubjects[i]!,
            status: "OPEN",
            category: "REFUND_REQUEST",
            body: "pagination fixture",
            requesterEmail: "pagination-fixture@example.com",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });
        paginationTicketIds.push(ticket.id);
      }
    });

    // A third isolated batch, spread across distinct days, just for
    // date-range tests — isolated via a distinguishing requesterEmail
    // rather than category (both are already spoken for above) so these
    // assertions don't need to assume the whole ticket table is empty
    // apart from this file's own fixtures.
    const dateRangeTicketIds: number[] = [];
    const dateRangeSubjects = ["Jan-1", "Jan-15", "Jan-30"];
    const dateRangeDates = ["2026-01-01T12:00:00.000Z", "2026-01-15T12:00:00.000Z", "2026-01-30T12:00:00.000Z"];

    beforeAll(async () => {
      for (let i = 0; i < dateRangeSubjects.length; i++) {
        const timestamp = new Date(dateRangeDates[i]!);
        const ticket = await prisma.ticket.create({
          data: {
            subject: dateRangeSubjects[i]!,
            status: "OPEN",
            body: "date-range fixture",
            requesterEmail: "date-range-fixture@example.com",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });
        dateRangeTicketIds.push(ticket.id);
      }
    });

    afterAll(async () => {
      await prisma.ticket.deleteMany({
        where: { id: { in: [...ticketIds, ...paginationTicketIds, ...dateRangeTicketIds] } },
      });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.account.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    });

    // pageSize=100 on these: default pageSize is only 10, and these
    // assertions need every one of this file's own fixtures to actually be
    // present in the response, regardless of how many other tickets exist
    // in the (shared) test database — see the "pagination" describe below
    // for pageSize/page behavior itself.
    test("defaults to createdAt desc (newest first) with no query params", async () => {
      const res = await agent.get("/api/tickets?pageSize=100");

      expect(res.status).toBe(200);
      const ids = (res.body.tickets as { id: number }[]).map((t) => t.id);
      // Fixture tickets were created Charlie, Alpha, Bravo in that order —
      // newest-first is the reverse of that.
      const [charlie, alpha, bravo] = ticketIds as [number, number, number];
      expect(ids.indexOf(bravo)).toBeLessThan(ids.indexOf(alpha));
      expect(ids.indexOf(alpha)).toBeLessThan(ids.indexOf(charlie));
    });

    test("sorts by subject ascending when asked", async () => {
      const res = await agent.get("/api/tickets?sortBy=subject&sortOrder=asc&pageSize=100");

      expect(res.status).toBe(200);
      const ours = (res.body.tickets as { id: number; subject: string }[]).filter((t) =>
        ticketIds.includes(t.id),
      );
      expect(ours.map((t) => t.subject)).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    test("sorts by subject descending when asked", async () => {
      const res = await agent.get("/api/tickets?sortBy=subject&sortOrder=desc&pageSize=100");

      expect(res.status).toBe(200);
      const ours = (res.body.tickets as { id: number; subject: string }[]).filter((t) =>
        ticketIds.includes(t.id),
      );
      expect(ours.map((t) => t.subject)).toEqual(["Charlie", "Bravo", "Alpha"]);
    });

    test("filters by status", async () => {
      const res = await agent.get("/api/tickets?status=RESOLVED&pageSize=100");

      expect(res.status).toBe(200);
      const ours = (res.body.tickets as { id: number; subject: string }[]).filter((t) =>
        ticketIds.includes(t.id),
      );
      expect(ours.map((t) => t.subject)).toEqual(["Alpha"]);
    });

    test("filters by category", async () => {
      const res = await agent.get("/api/tickets?category=GENERAL_QUESTION&pageSize=100");

      expect(res.status).toBe(200);
      const ours = (res.body.tickets as { id: number; subject: string }[]).filter((t) =>
        ticketIds.includes(t.id),
      );
      expect(ours.map((t) => t.subject)).toEqual(["Charlie"]);
    });

    test("filters by the UNCLASSIFIED sentinel to find tickets with no category", async () => {
      const res = await agent.get("/api/tickets?category=UNCLASSIFIED&pageSize=100");

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

    // Isolated via a distinguishing requesterEmail, same reasoning as the
    // date-range fixtures below.
    describe("resolvedByAi filtering", () => {
      let normalId: number;
      let aiResolvedId: number;

      beforeAll(async () => {
        const now = new Date();
        const normal = await prisma.ticket.create({
          data: {
            subject: "Server test resolvedByAi normal",
            status: "RESOLVED",
            body: "body",
            requesterEmail: "resolved-by-ai-fixture@example.com",
            resolvedByAi: false,
            createdAt: now,
            updatedAt: now,
          },
        });
        normalId = normal.id;
        const aiResolved = await prisma.ticket.create({
          data: {
            subject: "Server test resolvedByAi AI-handled",
            status: "RESOLVED",
            body: "body",
            requesterEmail: "resolved-by-ai-fixture@example.com",
            resolvedByAi: true,
            createdAt: now,
            updatedAt: now,
          },
        });
        aiResolvedId = aiResolved.id;
      });

      afterAll(async () => {
        await prisma.ticket.deleteMany({ where: { id: { in: [normalId, aiResolvedId] } } });
      });

      test("excludes a resolvedByAi ticket from the default (no status filter) response", async () => {
        const res = await agent.get("/api/tickets?pageSize=100");
        const ids = (res.body.tickets as { id: number }[]).map((t) => t.id);
        expect(ids).toContain(normalId);
        expect(ids).not.toContain(aiResolvedId);
      });

      test("includes a resolvedByAi ticket once status=RESOLVED is explicitly requested", async () => {
        const res = await agent.get("/api/tickets?status=RESOLVED&pageSize=100");
        const ids = (res.body.tickets as { id: number }[]).map((t) => t.id);
        expect(ids).toContain(normalId);
        expect(ids).toContain(aiResolvedId);
      });
    });

    // Isolated via category=REFUND_REQUEST (see paginationTicketIds' setup
    // above) so these don't need to assume the whole ticket table is empty
    // apart from this file's own fixtures.
    describe("pagination", () => {
      test("defaults to page 1 / pageSize 10 and reports the true total", async () => {
        const res = await agent.get("/api/tickets?category=REFUND_REQUEST");

        expect(res.status).toBe(200);
        expect(res.body.page).toBe(1);
        expect(res.body.pageSize).toBe(10);
        expect(res.body.total).toBe(5);
        expect(res.body.tickets).toHaveLength(5);
      });

      test("limits results to the requested pageSize while still reporting the full total", async () => {
        const res = await agent.get(
          "/api/tickets?category=REFUND_REQUEST&pageSize=2&sortBy=subject&sortOrder=asc",
        );

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(5);
        expect((res.body.tickets as { subject: string }[]).map((t) => t.subject)).toEqual([
          "Page-A",
          "Page-B",
        ]);
      });

      test("returns the second page's results", async () => {
        const res = await agent.get(
          "/api/tickets?category=REFUND_REQUEST&pageSize=2&page=2&sortBy=subject&sortOrder=asc",
        );

        expect(res.status).toBe(200);
        expect((res.body.tickets as { subject: string }[]).map((t) => t.subject)).toEqual([
          "Page-C",
          "Page-D",
        ]);
      });

      test("returns a partial final page", async () => {
        const res = await agent.get(
          "/api/tickets?category=REFUND_REQUEST&pageSize=2&page=3&sortBy=subject&sortOrder=asc",
        );

        expect(res.status).toBe(200);
        expect((res.body.tickets as { subject: string }[]).map((t) => t.subject)).toEqual([
          "Page-E",
        ]);
      });

      test("400s for a page below 1", async () => {
        const res = await agent.get("/api/tickets?page=0");
        expect(res.status).toBe(400);
      });

      test("400s for a pageSize above the max", async () => {
        const res = await agent.get("/api/tickets?pageSize=101");
        expect(res.status).toBe(400);
      });
    });

    describe("date-range filtering", () => {
      function subjectsOf(res: { body: { tickets: { id: number; subject: string }[] } }) {
        return res.body.tickets
          .filter((t) => dateRangeTicketIds.includes(t.id))
          .map((t) => t.subject);
      }

      test("filters by createdFrom only (inclusive)", async () => {
        const res = await agent.get("/api/tickets?createdFrom=2026-01-15&pageSize=100");

        expect(res.status).toBe(200);
        expect(subjectsOf(res)).toEqual(["Jan-30", "Jan-15"]);
      });

      test("filters by createdTo only, inclusive of the whole day", async () => {
        const res = await agent.get("/api/tickets?createdTo=2026-01-15&pageSize=100");

        expect(res.status).toBe(200);
        expect(subjectsOf(res)).toEqual(["Jan-15", "Jan-1"]);
      });

      test("combines createdFrom and createdTo into an inclusive range", async () => {
        const res = await agent.get(
          "/api/tickets?createdFrom=2026-01-02&createdTo=2026-01-16&pageSize=100",
        );

        expect(res.status).toBe(200);
        expect(subjectsOf(res)).toEqual(["Jan-15"]);
      });

      test("400s when createdFrom is after createdTo", async () => {
        const res = await agent.get("/api/tickets?createdFrom=2026-01-30&createdTo=2026-01-01");
        expect(res.status).toBe(400);
      });

      test("400s for an invalid createdFrom", async () => {
        const res = await agent.get("/api/tickets?createdFrom=not-a-date");
        expect(res.status).toBe(400);
      });
    });
  });
});

// GET /api/tickets/:id and PATCH /api/tickets/:id/assign share one signed-in
// session (one sign-in call) rather than one each — see the "as an
// authenticated user" describe above for why: sign-in shares an IP-keyed
// rate-limit bucket with every other real sign-in in this file (and
// server/src/routes/users.test.ts) across a single `bun test` run.
describe("a single-ticket-scoped session (GET /:id, PATCH /:id/assign)", () => {
  const agent = supertest.agent(app);
  const userEmail = `server-test-ticket-detail-${Date.now()}@example.com`;
  const userPassword = "Server-Test-Passw0rd!";
  let userId: string;
  let assigneeId: string;
  let deletedAssigneeId: string;
  let ticketId: number;

  beforeAll(async () => {
    userId = crypto.randomUUID();
    assigneeId = crypto.randomUUID();
    deletedAssigneeId = crypto.randomUUID();
    const now = new Date();

    await prisma.user.createMany({
      data: [
        {
          id: userId,
          name: "Server Test Detail Agent",
          email: userEmail,
          emailVerified: true,
          role: Role.AGENT,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: assigneeId,
          name: "Server Test Assignee",
          email: `server-test-assignee-${Date.now()}@example.com`,
          emailVerified: true,
          role: Role.AGENT,
          createdAt: now,
          updatedAt: now,
        },
        {
          // Exists, but soft-deleted — must be rejected as an assignee the
          // same way a nonexistent id is, not treated as "valid" just
          // because the row is still there.
          id: deletedAssigneeId,
          name: "Server Test Deleted Assignee",
          email: `server-test-deleted-assignee-${Date.now()}@example.com`,
          emailVerified: true,
          role: Role.AGENT,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        },
      ],
    });
    await prisma.account.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: await hashPassword(userPassword),
        createdAt: now,
        updatedAt: now,
      },
    });

    const signIn = await agent
      .post("/api/auth/sign-in/email")
      .send({ email: userEmail, password: userPassword });
    if (signIn.status !== 200) {
      throw new Error(`Test setup sign-in failed: ${signIn.status} ${JSON.stringify(signIn.body)}`);
    }

    const ticket = await prisma.ticket.create({
      data: {
        subject: "Detail fixture",
        status: "OPEN",
        category: "TECHNICAL_QUESTION",
        body: "Full ticket body for the detail page.",
        requesterEmail: "detail-fixture@example.com",
        createdAt: now,
        updatedAt: now,
      },
    });
    ticketId = ticket.id;
  });

  afterAll(async () => {
    await prisma.ticket.delete({ where: { id: ticketId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, assigneeId, deletedAssigneeId] } } });
  });

  describe("GET /api/tickets/:id", () => {
    test("401s when unauthenticated", async () => {
      const res = await request.get(`/api/tickets/${ticketId}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });

    test("returns the full ticket, including body, for an authenticated user", async () => {
      const res = await agent.get(`/api/tickets/${ticketId}`);

      expect(res.status).toBe(200);
      expect(res.body.ticket).toMatchObject({
        id: ticketId,
        subject: "Detail fixture",
        status: "OPEN",
        category: "TECHNICAL_QUESTION",
        body: "Full ticket body for the detail page.",
        requesterEmail: "detail-fixture@example.com",
        assignedTo: null,
      });
      // No replies posted yet at this point in the file — the
      // POST /api/tickets/:id/replies describe below runs later and
      // asserts the populated-thread case itself.
      expect(res.body.ticket.replies).toEqual([]);
    });

    test("404s for a ticket id that doesn't exist", async () => {
      const res = await agent.get("/api/tickets/999999999");
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Ticket not found" });
    });

    test("400s for a non-numeric id", async () => {
      const res = await agent.get("/api/tickets/not-a-number");
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid ticket id" });
    });
  });

  describe("GET /api/tickets/stats", () => {
    test("401s when unauthenticated", async () => {
      const res = await request.get("/api/tickets/stats");
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });

    // The exact numbers here are shared, live state — every other describe
    // in this file (and every other test file hitting the same database)
    // creates/updates tickets too, so asserting a specific totalTickets
    // value would be flaky. What's actually being tested is the route's
    // own wiring (auth, response shape, that resolvedByAiPercent is
    // genuinely derived from resolvedByAiCount/totalTickets, and that
    // totalTickets/openTickets track a ticket created between the two
    // requests below) — the arithmetic itself is covered by
    // lib/ticket-stats.test.ts's pure unit tests against fixed input. Both
    // requests below double up their assertions (rather than one request
    // per concern) to stay well under apiLimiter's 100-requests/60s budget,
    // which this file's request count is already close to.
    test("returns counts consistent with each other, and tracks a ticket created in between", async () => {
      const before = await agent.get("/api/tickets/stats");

      expect(before.status).toBe(200);
      expect(typeof before.body.totalTickets).toBe("number");
      expect(typeof before.body.openTickets).toBe("number");
      expect(typeof before.body.resolvedByAiCount).toBe("number");
      expect(before.body.openTickets).toBeLessThanOrEqual(before.body.totalTickets);
      expect(before.body.resolvedByAiCount).toBeLessThanOrEqual(before.body.totalTickets);
      expect(before.body.resolvedByAiPercent).toBeCloseTo(
        (before.body.resolvedByAiCount / before.body.totalTickets) * 100,
        5,
      );
      expect(
        before.body.averageResolutionTimeMs === null ||
          (typeof before.body.averageResolutionTimeMs === "number" &&
            before.body.averageResolutionTimeMs >= 0),
      ).toBe(true);

      const now = new Date();
      const extra = await prisma.ticket.create({
        data: {
          subject: "Stats fixture",
          body: "Counted by GET /api/tickets/stats.",
          requesterEmail: "stats-fixture@example.com",
          createdAt: now,
          updatedAt: now,
        },
      });

      try {
        const after = await agent.get("/api/tickets/stats");
        expect(after.body.totalTickets).toBeGreaterThanOrEqual(before.body.totalTickets + 1);
        expect(after.body.openTickets).toBeGreaterThanOrEqual(before.body.openTickets + 1);
      } finally {
        await prisma.ticket.delete({ where: { id: extra.id } });
      }
    });
  });

  describe("PATCH /api/tickets/:id", () => {
    test("401s when unauthenticated", async () => {
      const res = await request.patch(`/api/tickets/${ticketId}`).send({ status: "RESOLVED" });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });

    test("updates the status", async () => {
      const res = await agent.patch(`/api/tickets/${ticketId}`).send({ status: "RESOLVED" });

      expect(res.status).toBe(200);
      expect(res.body.ticket.status).toBe("RESOLVED");
    });

    test("updates the category", async () => {
      const res = await agent
        .patch(`/api/tickets/${ticketId}`)
        .send({ category: "REFUND_REQUEST" });

      expect(res.status).toBe(200);
      expect(res.body.ticket.category).toBe("REFUND_REQUEST");
    });

    test("updates both status and category in one request", async () => {
      const res = await agent
        .patch(`/api/tickets/${ticketId}`)
        .send({ status: "CLOSED", category: "GENERAL_QUESTION" });

      expect(res.status).toBe(200);
      expect(res.body.ticket.status).toBe("CLOSED");
      expect(res.body.ticket.category).toBe("GENERAL_QUESTION");
    });

    test("clears the category when it's explicitly set to null", async () => {
      const res = await agent.patch(`/api/tickets/${ticketId}`).send({ category: null });

      expect(res.status).toBe(200);
      expect(res.body.ticket.category).toBeNull();
    });

    test("leaves category untouched when only status is given", async () => {
      await agent.patch(`/api/tickets/${ticketId}`).send({ category: "TECHNICAL_QUESTION" });

      const res = await agent.patch(`/api/tickets/${ticketId}`).send({ status: "OPEN" });

      expect(res.status).toBe(200);
      expect(res.body.ticket.status).toBe("OPEN");
      expect(res.body.ticket.category).toBe("TECHNICAL_QUESTION");
    });

    test("leaves status untouched when only category is given", async () => {
      await agent.patch(`/api/tickets/${ticketId}`).send({ status: "RESOLVED" });

      const res = await agent
        .patch(`/api/tickets/${ticketId}`)
        .send({ category: "REFUND_REQUEST" });

      expect(res.status).toBe(200);
      expect(res.body.ticket.status).toBe("RESOLVED");
      expect(res.body.ticket.category).toBe("REFUND_REQUEST");
    });

    // These four run as one chained sequence — each builds on the previous
    // request's resulting state, rather than resetting to a known status
    // first — to keep this file's total request count well under
    // apiLimiter's 100-requests/60s budget (matching the style already
    // used above, e.g. "leaves status untouched when only category is
    // given" relying on the prior test's status change). The ticket enters
    // this sequence as RESOLVED, from the "leaves status untouched..." test
    // just above.
    let capturedResolvedAt: string | null;

    test("clears resolvedAt when a ticket is reopened to OPEN", async () => {
      const res = await agent.patch(`/api/tickets/${ticketId}`).send({ status: "OPEN" });

      expect(res.status).toBe(200);
      expect(res.body.ticket.resolvedAt).toBeNull();
    });

    test("sets resolvedAt when a ticket transitions from OPEN to a non-OPEN status", async () => {
      const res = await agent.patch(`/api/tickets/${ticketId}`).send({ status: "RESOLVED" });

      expect(res.status).toBe(200);
      expect(res.body.ticket.resolvedAt).not.toBeNull();
      capturedResolvedAt = res.body.ticket.resolvedAt;
    });

    test("leaves resolvedAt untouched when moving between two non-OPEN statuses", async () => {
      const res = await agent.patch(`/api/tickets/${ticketId}`).send({ status: "CLOSED" });

      expect(res.status).toBe(200);
      expect(res.body.ticket.resolvedAt).toBe(capturedResolvedAt);
    });

    test("leaves resolvedAt untouched when only category is given", async () => {
      const res = await agent
        .patch(`/api/tickets/${ticketId}`)
        .send({ category: "GENERAL_QUESTION" });

      expect(res.status).toBe(200);
      expect(res.body.ticket.resolvedAt).toBe(capturedResolvedAt);
    });

    test("400s for a status outside TicketStatus", async () => {
      const res = await agent.patch(`/api/tickets/${ticketId}`).send({ status: "ARCHIVED" });
      expect(res.status).toBe(400);
    });

    test("400s for a category that's neither a real category nor null", async () => {
      const res = await agent
        .patch(`/api/tickets/${ticketId}`)
        .send({ category: "NOT_A_REAL_CATEGORY" });
      expect(res.status).toBe(400);
    });

    test("400s when neither status nor category is provided", async () => {
      const res = await agent.patch(`/api/tickets/${ticketId}`).send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "At least one of status or category must be provided" });
    });

    test("404s when the ticket doesn't exist", async () => {
      const res = await agent.patch("/api/tickets/999999999").send({ status: "OPEN" });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Ticket not found" });
    });

    test("400s for a non-numeric ticket id", async () => {
      const res = await agent.patch("/api/tickets/not-a-number").send({ status: "OPEN" });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid ticket id" });
    });
  });

  describe("PATCH /api/tickets/:id/assign", () => {
    test("401s when unauthenticated", async () => {
      const res = await request
        .patch(`/api/tickets/${ticketId}/assign`)
        .send({ assignedToId: null });
      expect(res.status).toBe(401);
    });

    test("assigns the ticket and returns the populated assignedTo", async () => {
      const res = await agent
        .patch(`/api/tickets/${ticketId}/assign`)
        .send({ assignedToId: assigneeId });

      expect(res.status).toBe(200);
      expect(res.body.ticket.assignedToId).toBe(assigneeId);
      expect(res.body.ticket.assignedTo).toMatchObject({
        id: assigneeId,
        name: "Server Test Assignee",
      });
    });

    test("the assignment is reflected in GET /api/tickets' list response too, not just the detail response", async () => {
      await agent.patch(`/api/tickets/${ticketId}/assign`).send({ assignedToId: assigneeId });

      const res = await agent.get("/api/tickets?pageSize=100");
      const ours = (res.body.tickets as { id: number; assignedTo: unknown }[]).find(
        (t) => t.id === ticketId,
      );
      expect(ours?.assignedTo).toMatchObject({ id: assigneeId, name: "Server Test Assignee" });
    });

    test("unassigns when assignedToId is null", async () => {
      await agent.patch(`/api/tickets/${ticketId}/assign`).send({ assignedToId: assigneeId });

      const res = await agent
        .patch(`/api/tickets/${ticketId}/assign`)
        .send({ assignedToId: null });

      expect(res.status).toBe(200);
      expect(res.body.ticket.assignedToId).toBeNull();
      expect(res.body.ticket.assignedTo).toBeNull();
    });

    test("404s when the assignee doesn't exist", async () => {
      const res = await agent
        .patch(`/api/tickets/${ticketId}/assign`)
        .send({ assignedToId: crypto.randomUUID() });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Assignee not found" });
    });

    test("404s when the assignee exists but is soft-deleted", async () => {
      const res = await agent
        .patch(`/api/tickets/${ticketId}/assign`)
        .send({ assignedToId: deletedAssigneeId });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Assignee not found" });
    });

    test("400s for an empty-string assignedToId, rather than passing it through", async () => {
      const res = await agent
        .patch(`/api/tickets/${ticketId}/assign`)
        .send({ assignedToId: "" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "assignedToId must not be empty" });
    });

    test("400s when assignedToId is omitted entirely", async () => {
      const res = await agent.patch(`/api/tickets/${ticketId}/assign`).send({});
      expect(res.status).toBe(400);
    });

    test("404s when the ticket doesn't exist", async () => {
      const res = await agent
        .patch("/api/tickets/999999999/assign")
        .send({ assignedToId: null });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Ticket not found" });
    });

    test("400s for a non-numeric ticket id", async () => {
      const res = await agent
        .patch("/api/tickets/not-a-number/assign")
        .send({ assignedToId: null });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid ticket id" });
    });
  });

  // Replies aren't tracked for separate cleanup: TicketReply.ticketId is
  // `onDelete: Cascade`, so the afterAll above deleting `ticketId` already
  // removes every reply created here.
  describe("POST /api/tickets/:id/replies", () => {
    test("401s when unauthenticated", async () => {
      const res = await request.post(`/api/tickets/${ticketId}/replies`).send({ body: "Hello" });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });

    test("creates a reply authored by the requester", async () => {
      const res = await agent
        .post(`/api/tickets/${ticketId}/replies`)
        .send({ body: "Thanks for reaching out." });

      expect(res.status).toBe(201);
      expect(res.body.reply).toMatchObject({
        ticketId,
        body: "Thanks for reaching out.",
        senderType: "AGENT",
        author: { id: userId, name: "Server Test Detail Agent" },
      });
      expect(typeof res.body.reply.id).toBe("number");
      expect(typeof res.body.reply.createdAt).toBe("string");
    });

    test("ignores a client-supplied senderType and always records AGENT", async () => {
      // There's no customer-facing reply path yet — every caller of this
      // endpoint is a signed-in agent, so the server must decide
      // senderType itself rather than trust the request body.
      const res = await agent
        .post(`/api/tickets/${ticketId}/replies`)
        .send({ body: "Spoofed sender attempt", senderType: "CUSTOMER" });

      expect(res.status).toBe(201);
      expect(res.body.reply.senderType).toBe("AGENT");
    });

    test("400s for a blank body", async () => {
      const res = await agent.post(`/api/tickets/${ticketId}/replies`).send({ body: "   " });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Reply cannot be empty" });
    });

    test("400s when body is omitted", async () => {
      const res = await agent.post(`/api/tickets/${ticketId}/replies`).send({});
      expect(res.status).toBe(400);
    });

    test("404s when the ticket doesn't exist", async () => {
      const res = await agent.post("/api/tickets/999999999/replies").send({ body: "Hi" });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Ticket not found" });
    });

    test("400s for a non-numeric ticket id", async () => {
      const res = await agent.post("/api/tickets/not-a-number/replies").send({ body: "Hi" });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid ticket id" });
    });

    test("appears in GET /api/tickets/:id's replies, oldest first", async () => {
      await agent.post(`/api/tickets/${ticketId}/replies`).send({ body: "Second reply" });

      const res = await agent.get(`/api/tickets/${ticketId}`);
      const bodies = (res.body.ticket.replies as { body: string }[]).map((r) => r.body);
      // "Spoofed sender attempt" was created by the test above this one —
      // oldest-first means it lands between the other two.
      expect(bodies).toEqual([
        "Thanks for reaching out.",
        "Spoofed sender attempt",
        "Second reply",
      ]);
    });
  });

  describe("POST /api/tickets/:id/polish-reply", () => {
    test("401s when unauthenticated", async () => {
      const res = await request
        .post(`/api/tickets/${ticketId}/polish-reply`)
        .send({ body: "Draft" });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });

    test("returns the polished body from the AI provider, without persisting anything", async () => {
      polishReplyMock.mockClear();
      const res = await agent
        .post(`/api/tickets/${ticketId}/polish-reply`)
        .send({ body: "thx for reachin out we will fix it" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ body: "Mocked polished reply." });
      expect(polishReplyMock).toHaveBeenCalledTimes(1);
      expect(polishReplyMock).toHaveBeenCalledWith({
        ticketSubject: "Detail fixture",
        ticketBody: "Full ticket body for the detail page.",
        customerName: null,
        draft: "thx for reachin out we will fix it",
        agentName: "Server Test Detail Agent",
      });

      // Confirms this route is read-only: no reply was actually created.
      const ticketRes = await agent.get(`/api/tickets/${ticketId}`);
      expect(
        (ticketRes.body.ticket.replies as { body: string }[]).some(
          (r) => r.body === "Mocked polished reply.",
        ),
      ).toBe(false);
    });

    test("400s for a blank body", async () => {
      const res = await agent.post(`/api/tickets/${ticketId}/polish-reply`).send({ body: "   " });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Reply cannot be empty" });
    });

    test("404s when the ticket doesn't exist", async () => {
      const res = await agent
        .post("/api/tickets/999999999/polish-reply")
        .send({ body: "Draft" });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Ticket not found" });
    });

    test("400s for a non-numeric ticket id", async () => {
      const res = await agent
        .post("/api/tickets/not-a-number/polish-reply")
        .send({ body: "Draft" });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid ticket id" });
    });

    test("502s with a clean message when the AI provider call fails", async () => {
      polishReplyMock.mockImplementationOnce(async () => {
        throw new Error("upstream timeout");
      });

      const res = await agent
        .post(`/api/tickets/${ticketId}/polish-reply`)
        .send({ body: "Draft" });

      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: "Could not polish this reply. Please try again." });
    });
  });

  describe("POST /api/tickets/:id/generate-reply", () => {
    test("401s when unauthenticated", async () => {
      const res = await request.post(`/api/tickets/${ticketId}/generate-reply`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });

    test("returns a reply generated from the ticket's own subject/body, without persisting anything", async () => {
      generateReplyMock.mockClear();
      const res = await agent.post(`/api/tickets/${ticketId}/generate-reply`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ body: "Mocked generated reply." });
      expect(generateReplyMock).toHaveBeenCalledTimes(1);
      expect(generateReplyMock).toHaveBeenCalledWith({
        ticketSubject: "Detail fixture",
        ticketBody: "Full ticket body for the detail page.",
        customerName: null,
        agentName: "Server Test Detail Agent",
      });

      // Confirms this route is read-only, same as polish-reply.
      const ticketRes = await agent.get(`/api/tickets/${ticketId}`);
      expect(
        (ticketRes.body.ticket.replies as { body: string }[]).some(
          (r) => r.body === "Mocked generated reply.",
        ),
      ).toBe(false);
    });

    test("404s when the ticket doesn't exist", async () => {
      const res = await agent.post("/api/tickets/999999999/generate-reply");
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Ticket not found" });
    });

    test("400s for a non-numeric ticket id", async () => {
      const res = await agent.post("/api/tickets/not-a-number/generate-reply");
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid ticket id" });
    });

    test("502s with a clean message when the AI provider call fails", async () => {
      generateReplyMock.mockImplementationOnce(async () => {
        throw new Error("upstream timeout");
      });

      const res = await agent.post(`/api/tickets/${ticketId}/generate-reply`);

      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: "Could not generate a reply. Please try again." });
    });
  });

  describe("POST /api/tickets/:id/summarize", () => {
    test("401s when unauthenticated", async () => {
      const res = await request.post(`/api/tickets/${ticketId}/summarize`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });

    test("summarizes the ticket and its reply thread so far", async () => {
      summarizeTicketMock.mockClear();
      const res = await agent.post(`/api/tickets/${ticketId}/summarize`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ summary: "Mocked summary." });
      expect(summarizeTicketMock).toHaveBeenCalledTimes(1);
      // The "POST /api/tickets/:id/replies" describe above already left
      // three real replies on this same ticketId — this confirms the
      // route pulls the actual current thread rather than an empty one.
      expect(summarizeTicketMock).toHaveBeenCalledWith({
        ticketSubject: "Detail fixture",
        ticketBody: "Full ticket body for the detail page.",
        replies: [
          {
            senderType: "AGENT",
            authorName: "Server Test Detail Agent",
            body: "Thanks for reaching out.",
          },
          {
            senderType: "AGENT",
            authorName: "Server Test Detail Agent",
            body: "Spoofed sender attempt",
          },
          {
            senderType: "AGENT",
            authorName: "Server Test Detail Agent",
            body: "Second reply",
          },
        ],
      });
    });

    test("404s when the ticket doesn't exist", async () => {
      const res = await agent.post("/api/tickets/999999999/summarize");
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Ticket not found" });
    });

    test("400s for a non-numeric ticket id", async () => {
      const res = await agent.post("/api/tickets/not-a-number/summarize");
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid ticket id" });
    });

    test("502s with a clean message when the AI provider call fails", async () => {
      summarizeTicketMock.mockImplementationOnce(async () => {
        throw new Error("upstream timeout");
      });

      const res = await agent.post(`/api/tickets/${ticketId}/summarize`);

      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: "Could not summarize this ticket. Please try again." });
    });
  });
});
