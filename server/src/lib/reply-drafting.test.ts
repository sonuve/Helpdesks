import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mocks the `ai` package's generateText directly (rather than mock.module-ing
// this file itself, the way tickets.test.ts does for its route tests) so
// this file can exercise the real polishReply/generateReply — in
// particular the deterministic sign-off appended after the AI call, which
// tickets.test.ts's whole-module mock never runs. Must be registered
// before importing ./reply-drafting.js, since that import is what evaluates
// its top-level `google(...)` call and binds its `generateText` reference.
const generateTextMock = mock(async (_options: { system: string; prompt: string }) => ({
  text: "  Raw AI output.  ",
}));
mock.module("ai", () => ({ generateText: generateTextMock }));
// reply-drafting.ts's `google("gemini-3.5-flash-lite")` call at module load
// time doesn't need a real GOOGLE_GENERATIVE_AI_API_KEY (server/.env.test
// deliberately has none — see its comment) as long as generateText itself
// is mocked and never actually invokes the provider, but mock it too for
// isolation from @ai-sdk/google's own behavior.
mock.module("@ai-sdk/google", () => ({ google: () => "mocked-model" }));

const { generateReply, polishReply } = await import("./reply-drafting.js");

beforeEach(() => {
  generateTextMock.mockClear();
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
