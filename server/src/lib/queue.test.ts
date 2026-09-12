import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// pg-boss needs a real Postgres connection and its own schema migration to
// do anything real — replaced here so this file can test enqueueClassifyTicket
// and processClassifyTicketJobs without starting an actual queue. Must be
// registered before importing ./queue.js, since that import is what
// constructs `new PgBoss(...)` at module load time.
const sendMock = mock(async () => "mocked-job-id");
class MockPgBoss {
  on() {}
  send = sendMock;
  start = mock(async () => {});
  createQueue = mock(async () => {});
  work = mock(async () => "mocked-work-id");
}
mock.module("pg-boss", () => ({ PgBoss: MockPgBoss }));

// Replaced so this file never makes a real AI call — scoped to this file
// only (server/package.json's test script runs `bun test --isolate`, one
// module registry per file), so this doesn't need to account for
// tickets.test.ts's separate mock of the same resolved path.
const classifyTicketMock = mock(async () => "GENERAL_QUESTION");
const evaluateAutoResolutionMock = mock(
  async (): Promise<{ resolvable: boolean; reply: string | null }> => ({
    resolvable: false,
    reply: null,
  }),
);
mock.module("./ticket-analysis.js", () => ({
  classifyTicket: classifyTicketMock,
  evaluateAutoResolution: evaluateAutoResolutionMock,
  AI_ASSISTANT_NAME: "AI Assistant",
}));

const {
  enqueueAutoResolveTicket,
  enqueueClassifyTicket,
  processAutoResolveTicketJobs,
  processClassifyTicketJobs,
} = await import("./queue.js");
const { prisma } = await import("./prisma.js");

beforeEach(() => {
  sendMock.mockClear();
  classifyTicketMock.mockClear();
  evaluateAutoResolutionMock.mockClear();
});

const createdTicketIds: number[] = [];

afterAll(async () => {
  if (createdTicketIds.length > 0) {
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
  }
  await prisma.$disconnect();
});

async function createTicket(subject: string, body: string, requesterName: string | null = null) {
  const now = new Date();
  const ticket = await prisma.ticket.create({
    data: {
      subject,
      body,
      requesterEmail: "queue-test@example.com",
      requesterName,
      createdAt: now,
      updatedAt: now,
    },
  });
  createdTicketIds.push(ticket.id);
  return ticket;
}

describe("enqueueClassifyTicket", () => {
  test("sends a classify-ticket job with the ticket's id, subject, and body", async () => {
    const ticket = await createTicket("Can't log in", "I forgot my password.");

    await enqueueClassifyTicket(ticket);

    expect(sendMock).toHaveBeenCalledWith("classify-ticket", {
      ticketId: ticket.id,
      subject: "Can't log in",
      body: "I forgot my password.",
    });
  });
});

describe("enqueueAutoResolveTicket", () => {
  test("sends an auto-resolve-ticket job with the ticket's id, subject, body, and requesterName", async () => {
    const ticket = await createTicket("Can't log in", "I forgot my password.", "Isabella Moreau");

    await enqueueAutoResolveTicket(ticket);

    expect(sendMock).toHaveBeenCalledWith("auto-resolve-ticket", {
      ticketId: ticket.id,
      subject: "Can't log in",
      body: "I forgot my password.",
      customerName: "Isabella Moreau",
    });
  });
});

describe("processClassifyTicketJobs", () => {
  test("classifies the ticket and saves the category", async () => {
    classifyTicketMock.mockResolvedValueOnce("REFUND_REQUEST");
    const ticket = await createTicket("Refund please", "I'd like my money back.");

    await processClassifyTicketJobs([
      { id: "job-1", data: { ticketId: ticket.id, subject: ticket.subject, body: ticket.body } },
    ]);

    expect(classifyTicketMock).toHaveBeenCalledWith({
      ticketSubject: ticket.subject,
      ticketBody: ticket.body,
    });
    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.category).toBe("REFUND_REQUEST");
  });

  test("processes every job in the batch", async () => {
    classifyTicketMock
      .mockResolvedValueOnce("GENERAL_QUESTION")
      .mockResolvedValueOnce("TECHNICAL_QUESTION");
    const ticketA = await createTicket("Question A", "Body A");
    const ticketB = await createTicket("Question B", "Body B");

    await processClassifyTicketJobs([
      { id: "job-a", data: { ticketId: ticketA.id, subject: ticketA.subject, body: ticketA.body } },
      { id: "job-b", data: { ticketId: ticketB.id, subject: ticketB.subject, body: ticketB.body } },
    ]);

    const updatedA = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketA.id } });
    const updatedB = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketB.id } });
    expect(updatedA.category).toBe("GENERAL_QUESTION");
    expect(updatedB.category).toBe("TECHNICAL_QUESTION");
  });

  test("a failing job doesn't stop the rest of the batch from being processed", async () => {
    classifyTicketMock
      .mockRejectedValueOnce(new Error("upstream timeout"))
      .mockResolvedValueOnce("GENERAL_QUESTION");
    const failing = await createTicket("Will fail", "Body");
    const succeeding = await createTicket("Will succeed", "Body");

    await processClassifyTicketJobs([
      { id: "job-fail", data: { ticketId: failing.id, subject: failing.subject, body: failing.body } },
      {
        id: "job-succeed",
        data: { ticketId: succeeding.id, subject: succeeding.subject, body: succeeding.body },
      },
    ]);

    const updatedFailing = await prisma.ticket.findUniqueOrThrow({ where: { id: failing.id } });
    const updatedSucceeding = await prisma.ticket.findUniqueOrThrow({
      where: { id: succeeding.id },
    });
    expect(updatedFailing.category).toBeNull();
    expect(updatedSucceeding.category).toBe("GENERAL_QUESTION");
  });
});

describe("processAutoResolveTicketJobs", () => {
  test("leaves the ticket untouched when the model judges it not resolvable", async () => {
    evaluateAutoResolutionMock.mockResolvedValueOnce({ resolvable: false, reply: null });
    const ticket = await createTicket("Refund please", "I'd like my money back.");

    await processAutoResolveTicketJobs([
      {
        id: "job-1",
        data: {
          ticketId: ticket.id,
          subject: ticket.subject,
          body: ticket.body,
          customerName: null,
        },
      },
    ]);

    const updated = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { replies: true },
    });
    expect(updated.status).toBe("OPEN");
    expect(updated.resolvedByAi).toBe(false);
    expect(updated.replies).toHaveLength(0);
  });

  test("sends a reply authored by AI Assistant and resolves the ticket when judged resolvable", async () => {
    evaluateAutoResolutionMock.mockResolvedValueOnce({
      resolvable: true,
      reply: "Hi there, here is the answer to your question.",
    });
    const ticket = await createTicket("How do I reset my password?", "I forgot it.");

    await processAutoResolveTicketJobs([
      {
        id: "job-1",
        data: {
          ticketId: ticket.id,
          subject: ticket.subject,
          body: ticket.body,
          customerName: null,
        },
      },
    ]);

    const updated = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { replies: { include: { author: true } } },
    });
    expect(updated.status).toBe("RESOLVED");
    expect(updated.resolvedByAi).toBe(true);
    expect(updated.replies).toHaveLength(1);
    expect(updated.replies[0]!.body).toBe("Hi there, here is the answer to your question.");
    expect(updated.replies[0]!.senderType).toBe("AGENT");
    expect(updated.replies[0]!.author.email).toBe("ai-assistant@internal.helpdesks");
    expect(updated.replies[0]!.author.name).toBe("AI Assistant");
  });

  test("passes the ticket's customerName through to the AI judgment call", async () => {
    evaluateAutoResolutionMock.mockResolvedValueOnce({ resolvable: false, reply: null });
    const ticket = await createTicket("Question", "Body", "Isabella Moreau");

    await processAutoResolveTicketJobs([
      {
        id: "job-1",
        data: {
          ticketId: ticket.id,
          subject: ticket.subject,
          body: ticket.body,
          customerName: "Isabella Moreau",
        },
      },
    ]);

    expect(evaluateAutoResolutionMock).toHaveBeenCalledWith({
      ticketSubject: ticket.subject,
      ticketBody: ticket.body,
      customerName: "Isabella Moreau",
    });
  });

  test("a failing job doesn't stop the rest of the batch, and leaves that ticket unresolved", async () => {
    evaluateAutoResolutionMock
      .mockRejectedValueOnce(new Error("upstream timeout"))
      .mockResolvedValueOnce({ resolvable: true, reply: "All set!" });
    const failing = await createTicket("Will fail", "Body");
    const succeeding = await createTicket("Will succeed", "Body");

    await processAutoResolveTicketJobs([
      {
        id: "job-fail",
        data: {
          ticketId: failing.id,
          subject: failing.subject,
          body: failing.body,
          customerName: null,
        },
      },
      {
        id: "job-succeed",
        data: {
          ticketId: succeeding.id,
          subject: succeeding.subject,
          body: succeeding.body,
          customerName: null,
        },
      },
    ]);

    const updatedFailing = await prisma.ticket.findUniqueOrThrow({ where: { id: failing.id } });
    const updatedSucceeding = await prisma.ticket.findUniqueOrThrow({
      where: { id: succeeding.id },
    });
    expect(updatedFailing.status).toBe("OPEN");
    expect(updatedFailing.resolvedByAi).toBe(false);
    expect(updatedSucceeding.status).toBe("RESOLVED");
    expect(updatedSucceeding.resolvedByAi).toBe(true);
  });
});
