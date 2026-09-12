import { afterAll, describe, expect, mock, test } from "bun:test";
import supertest from "supertest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

// Same reasoning/mechanics as tickets.test.ts's own mock of this module:
// this route also calls lib/ticket-ingestion.ts's createTicketFromEmail,
// which enqueues real pg-boss jobs — mocked here so this suite never
// starts a real queue. Scoped to this file only (server/package.json's
// test script runs `bun test --isolate`).
const enqueueClassifyTicketMock = mock(async () => {});
const enqueueAutoResolveTicketMock = mock(async () => {});
mock.module("../lib/queue.js", () => ({
  enqueueClassifyTicket: enqueueClassifyTicketMock,
  enqueueAutoResolveTicket: enqueueAutoResolveTicketMock,
}));

// POST /api/email/inbound/:secret: the real SendGrid Inbound Parse
// webhook (see project-scope.md's "Email ingestion provider" decision).
// Pure request/parsing/validation/response-shape logic, so this runs
// against the Express app in-process via supertest rather than the
// Playwright e2e harness — see CLAUDE.md's "Server testing" section.
const request = supertest(app);

const INGEST_SECRET = process.env.EMAIL_INGEST_SECRET;
if (!INGEST_SECRET) {
  throw new Error(
    "EMAIL_INGEST_SECRET is not set — expected `bun --env-file=.env.test test` to have loaded it.",
  );
}

const createdTicketIds: number[] = [];

afterAll(async () => {
  if (createdTicketIds.length > 0) {
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
  }
  await prisma.$disconnect();
});

describe("POST /api/email/inbound/:secret", () => {
  test("404s when no secret segment is present in the path", async () => {
    const res = await request
      .post("/api/email/inbound/")
      .field("from", "customer@example.com")
      .field("subject", "Help")
      .field("text", "Something is broken.");

    // :secret requires a non-empty segment, so this doesn't match the
    // route at all rather than reaching the handler's own check.
    expect(res.status).toBe(404);
  });

  test("401s with a wrong secret in the path", async () => {
    const res = await request
      .post("/api/email/inbound/definitely-not-the-secret")
      .field("from", "customer@example.com")
      .field("subject", "Help")
      .field("text", "Something is broken.");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  test("400s when `from` is missing", async () => {
    const res = await request
      .post(`/api/email/inbound/${INGEST_SECRET}`)
      .field("subject", "Help")
      .field("text", "Something is broken.");

    expect(res.status).toBe(400);
  });

  // SendGrid's default (non-raw) Inbound Parse mode: parsed fields as
  // separate multipart form fields, `from` as a raw header string.
  describe("parsed-fields mode", () => {
    test("201s, splits a quoted display name out of `from`, and creates a ticket", async () => {
      const subject = `SendGrid parsed-fields ingestion ${Date.now()}`;
      const res = await request
        .post(`/api/email/inbound/${INGEST_SECRET}`)
        .field("from", '"Jane Doe" <Customer@Example.com>')
        .field("subject", subject)
        .field("text", "My printer is on fire.");

      expect(res.status).toBe(201);
      createdTicketIds.push(res.body.ticket.id);
      expect(res.body.ticket).toMatchObject({
        status: "OPEN",
        category: null,
        subject,
        body: "My printer is on fire.",
        // Stored lowercased regardless of the casing SendGrid forwarded.
        requesterEmail: "customer@example.com",
        requesterName: "Jane Doe",
      });
    });

    test("accepts a bare email address with no display name", async () => {
      const subject = `SendGrid parsed-fields no-name ${Date.now()}`;
      const res = await request
        .post(`/api/email/inbound/${INGEST_SECRET}`)
        .field("from", "customer@example.com")
        .field("subject", subject)
        .field("text", "No display name on this one.");

      expect(res.status).toBe(201);
      createdTicketIds.push(res.body.ticket.id);
      expect(res.body.ticket.requesterName).toBeNull();
    });

    test('falls back to "(no subject)" when subject is omitted', async () => {
      const res = await request
        .post(`/api/email/inbound/${INGEST_SECRET}`)
        .field("from", "customer@example.com")
        .field("text", `SendGrid parsed-fields no-subject ${Date.now()}`);

      expect(res.status).toBe(201);
      createdTicketIds.push(res.body.ticket.id);
      expect(res.body.ticket.subject).toBe("(no subject)");
    });

    test("falls back to `html` when `text` is absent", async () => {
      const subject = `SendGrid parsed-fields html-only ${Date.now()}`;
      const res = await request
        .post(`/api/email/inbound/${INGEST_SECRET}`)
        .field("from", "customer@example.com")
        .field("subject", subject)
        .field("html", "<p>Only HTML was provided.</p>");

      expect(res.status).toBe(201);
      createdTicketIds.push(res.body.ticket.id);
      expect(res.body.ticket.body).toBe("<p>Only HTML was provided.</p>");
    });
  });

  // SendGrid's "POST the raw, full MIME message" mode (a single `email`
  // field holding the entire message) is deliberately not supported — see
  // the comment on SENDGRID_PARSE_KEYS in routes/inbound-email.ts for why
  // (a real crash in @sendgrid/inbound-mail-parser's raw-mode code path
  // under Bun, not just an unimplemented feature). Sending an `email`
  // field here is exactly like sending no recognized fields at all: none
  // of SENDGRID_PARSE_KEYS match, so `from` ends up missing and this 400s
  // rather than 500ing.
  test("400s for SendGrid's raw-MIME payload shape (unsupported) instead of crashing", async () => {
    const res = await request
      .post(`/api/email/inbound/${INGEST_SECRET}`)
      .field("email", "From: Jane Doe <customer@example.com>\r\n\r\nBody.");

    expect(res.status).toBe(400);
  });
});
