import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mocks the `ai` package's generateText directly (rather than mock.module-ing
// this file itself, the way tickets.test.ts does for its route tests) so
// this file can exercise the real polishReply/generateReply — in
// particular the deterministic sign-off appended after the AI call, which
// tickets.test.ts's whole-module mock never runs. Must be registered
// before importing ./ai.js, since that import is what evaluates `ai.ts`'s
// top-level `google(...)` call and binds its `generateText` reference.
const generateTextMock = mock(async (_options: { system: string; prompt: string }) => ({
  text: "  Raw AI output.  ",
}));
// Shared between classifyTicket's enum output mode (`object` is a plain
// string) and evaluateAutoResolution's schema mode (`object` is
// `{ resolvable, reply }`) — one mock per external dependency, not one
// per internal caller of it.
type GenerateObjectResult =
  | { resolvable: boolean; reply: string | null }
  | "GENERAL_QUESTION"
  | "TECHNICAL_QUESTION"
  | "REFUND_REQUEST";
const generateObjectMock = mock(
  async (_options: { system: string; prompt: string; enum?: string[] }): Promise<{
    object: GenerateObjectResult;
  }> => ({
    object: "GENERAL_QUESTION",
  }),
);
mock.module("ai", () => ({ generateText: generateTextMock, generateObject: generateObjectMock }));
// ai.ts's `google("gemini-3.5-flash-lite")` call at module load time
// doesn't need a real GOOGLE_GENERATIVE_AI_API_KEY (server/.env.test
// deliberately has none — see its comment) as long as generateText itself
// is mocked and never actually invokes the provider, but mock it too for
// isolation from @ai-sdk/google's own behavior.
mock.module("@ai-sdk/google", () => ({ google: () => "mocked-model" }));

const { classifyTicket, evaluateAutoResolution, generateReply, polishReply, summarizeTicket } =
  await import("./ai.js");

beforeEach(() => {
  generateTextMock.mockClear();
  generateObjectMock.mockClear();
});

describe("polishReply", () => {
  test("signs the AI's output with the agent's name and the fixed link", async () => {
    const result = await polishReply({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
      draft: "draft text",
      agentName: "Jane Doe",
    });

    expect(result).toBe(
      "Raw AI output.\n\nBest regards,\nJane Doe\nCodeWithMosh Support\nhttps://codewithmosh.com",
    );
  });

  test("tells the model to greet the customer by first name only, from a full name", async () => {
    await polishReply({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: "Isabella Moreau",
      draft: "draft text",
      agentName: "Jane Doe",
    });

    const [{ system }] = generateTextMock.mock.calls[0]!;
    expect(system).toContain("Isabella");
    expect(system).not.toContain("Moreau");
  });

  test("tells the model not to invent a name when none is on file", async () => {
    await polishReply({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
      draft: "draft text",
      agentName: "Jane Doe",
    });

    const [{ system }] = generateTextMock.mock.calls[0]!;
    expect(system).toContain("isn't known");
  });

  test("tells the model to keep a professional, customer-friendly tone and proper paragraph formatting", async () => {
    await polishReply({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
      draft: "draft text",
      agentName: "Jane Doe",
    });

    const [{ system }] = generateTextMock.mock.calls[0]!;
    expect(system).toContain("customer-friendly");
    expect(system).toContain("clear paragraphs");
  });
});

describe("generateReply", () => {
  test("signs the AI's output with the agent's name and the fixed link", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "  Another raw output.  " });

    const result = await generateReply({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
      agentName: "John Smith",
    });

    expect(result).toBe(
      "Another raw output.\n\nBest regards,\nJohn Smith\nCodeWithMosh Support\nhttps://codewithmosh.com",
    );
  });

  test("tells the model to greet the customer by first name only, from a full name", async () => {
    await generateReply({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: "Isabella Moreau",
      agentName: "John Smith",
    });

    const [{ system }] = generateTextMock.mock.calls[0]!;
    expect(system).toContain("Isabella");
    expect(system).not.toContain("Moreau");
  });

  test("tells the model not to invent a name when none is on file", async () => {
    await generateReply({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
      agentName: "John Smith",
    });

    const [{ system }] = generateTextMock.mock.calls[0]!;
    expect(system).toContain("isn't known");
  });

  test("tells the model to keep a professional, customer-friendly tone and proper paragraph formatting", async () => {
    await generateReply({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
      agentName: "John Smith",
    });

    const [{ system }] = generateTextMock.mock.calls[0]!;
    expect(system).toContain("customer-friendly");
    expect(system).toContain("clear paragraphs");
  });
});

describe("summarizeTicket", () => {
  test("returns the AI's output as-is, with no sign-off or greeting appended", async () => {
    const result = await summarizeTicket({
      ticketSubject: "Subject",
      ticketBody: "Body",
      replies: [],
    });

    expect(result).toBe("Raw AI output.");
  });

  test("includes the reply thread, oldest first, in the prompt", async () => {
    await summarizeTicket({
      ticketSubject: "Subject",
      ticketBody: "Body",
      replies: [
        { senderType: "CUSTOMER", authorName: "Isabella Moreau", body: "It still crashes." },
        { senderType: "AGENT", authorName: "Agent", body: "Can you share a screenshot?" },
      ],
    });

    const [{ prompt }] = generateTextMock.mock.calls[0]!;
    const customerIndex = prompt.indexOf("It still crashes.");
    const agentIndex = prompt.indexOf("Can you share a screenshot?");
    expect(customerIndex).toBeGreaterThan(-1);
    expect(agentIndex).toBeGreaterThan(customerIndex);
  });

  test("notes there are no replies yet when the thread is empty", async () => {
    await summarizeTicket({ ticketSubject: "Subject", ticketBody: "Body", replies: [] });

    const [{ prompt }] = generateTextMock.mock.calls[0]!;
    expect(prompt).toContain("no replies yet");
  });

  test("tells the model this is an internal note, not a customer-facing message", async () => {
    await summarizeTicket({ ticketSubject: "Subject", ticketBody: "Body", replies: [] });

    const [{ system }] = generateTextMock.mock.calls[0]!;
    expect(system).toContain("not a message to the customer");
  });
});

describe("classifyTicket", () => {
  test("returns the model's chosen category", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: "REFUND_REQUEST" });

    const result = await classifyTicket({ ticketSubject: "Subject", ticketBody: "Body" });

    expect(result).toBe("REFUND_REQUEST");
  });

  test("constrains the model to exactly the three TicketCategory values", async () => {
    await classifyTicket({ ticketSubject: "Subject", ticketBody: "Body" });

    const [{ enum: categoryEnum }] = generateObjectMock.mock.calls[0]!;
    expect(categoryEnum!.sort()).toEqual(
      ["GENERAL_QUESTION", "REFUND_REQUEST", "TECHNICAL_QUESTION"].sort(),
    );
  });

  test("includes the ticket subject and body in the prompt", async () => {
    await classifyTicket({
      ticketSubject: "Can't upload files",
      ticketBody: "My upload keeps failing.",
    });

    const [{ prompt }] = generateObjectMock.mock.calls[0]!;
    expect(prompt).toContain("Can't upload files");
    expect(prompt).toContain("My upload keeps failing.");
  });
});

describe("evaluateAutoResolution", () => {
  test("returns resolvable: true with the trimmed, signed reply when the model judges it resolvable", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { resolvable: true, reply: "  Here's the answer.  " },
    });

    const result = await evaluateAutoResolution({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
    });

    expect(result).toEqual({
      resolvable: true,
      reply: "Here's the answer.\n\nBest regards,\nAI Assistant\nCodeWithMosh Support\nhttps://codewithmosh.com",
    });
  });

  test("returns resolvable: false, reply: null when the model judges it not resolvable", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: { resolvable: false, reply: null } });

    const result = await evaluateAutoResolution({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
    });

    expect(result).toEqual({ resolvable: false, reply: null });
  });

  test("treats resolvable: true with a blank/missing reply as not resolvable, rather than sending nothing", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: { resolvable: true, reply: "   " } });

    const result = await evaluateAutoResolution({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
    });

    expect(result).toEqual({ resolvable: false, reply: null });
  });

  test("tells the model to greet the customer by first name only, from a full name", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: { resolvable: false, reply: null } });

    await evaluateAutoResolution({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: "Isabella Moreau",
    });

    const [{ system }] = generateObjectMock.mock.calls[0]!;
    expect(system).toContain("Isabella");
    expect(system).not.toContain("Moreau");
  });

  test("tells the model to default to not-resolvable when unsure, and never to fabricate order/account details", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: { resolvable: false, reply: null } });

    await evaluateAutoResolution({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
    });

    const [{ system }] = generateObjectMock.mock.calls[0]!;
    expect(system).toContain("not resolvable");
    expect(system).toContain("no access to the customer's account");
  });

  test("tells the model to keep a professional, customer-friendly tone and proper paragraph formatting", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: { resolvable: false, reply: null } });

    await evaluateAutoResolution({
      ticketSubject: "Subject",
      ticketBody: "Body",
      customerName: null,
    });

    const [{ system }] = generateObjectMock.mock.calls[0]!;
    expect(system).toContain("customer-friendly");
    expect(system).toContain("clear paragraphs");
  });
});
