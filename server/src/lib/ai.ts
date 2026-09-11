import { google } from "@ai-sdk/google";
import { generateObject, generateText } from "ai";
import { TicketCategory } from "../generated/prisma/enums.js";

// Gemini 3.5 Flash-Lite: small/fast and covered by Google AI Studio's free
// tier, unlike tech-stack.md's Anthropic Claude pick for the full
// classification/reply-drafting system (project-scope.md/implementation-plan.md) —
// this is a lighter-weight, human-in-the-loop "polish my draft" assist, not
// that autonomous system, so it doesn't need to match it. Requires
// GOOGLE_GENERATIVE_AI_API_KEY (server/.env) — get a free key from Google
// AI Studio. (Was gemini-2.0-flash-lite; Google retired that model id in
// 2026 in favor of this one — if this endpoint starts 502ing with an
// AI_APICallError citing a retired model, check Google AI Studio's current
// model list and update this string.)
const model = google("gemini-3.5-flash-lite");

// Appended deterministically rather than left to the model to include —
// asking the LLM to sign off consistently (right name, right link, every
// time) is less reliable than just appending it ourselves after the fact.
function signReply(text: string, agentName: string): string {
  return `${text}\n\nBest regards,\n${agentName}\nhttps://codewithmosh.com`;
}

// Ticket.requesterName (schema.prisma) is a free-text display name, not
// separate first/last fields — take just the first token so the greeting
// never reads "Hi Isabella Moreau,". Returns null (never a guess) when
// there's no name to work with, so the prompt can fall back to a generic
// greeting instead of addressing someone by a fabricated name.
function firstNameOf(fullName: string | null): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first || null;
}

// The agent's own draft is what should come back improved, never replaced
// by something unrelated — the prompt asks for clarity/tone/grammar edits
// only, preserving every factual claim the agent already wrote (the AI has
// no ticket-resolution authority here, just wording).
export async function polishReply({
  ticketSubject,
  ticketBody,
  customerName,
  draft,
  agentName,
}: {
  ticketSubject: string;
  ticketBody: string;
  customerName: string | null;
  draft: string;
  agentName: string;
}): Promise<string> {
  const customerFirstName = firstNameOf(customerName);
  const { text } = await generateText({
    model,
    system:
      "You help a customer support agent polish a draft reply to a support ticket before it's sent. " +
      "Improve clarity, tone, and grammar. Preserve the agent's intent and every factual claim in the draft " +
      "— do not add new information, promises, or claims that aren't already in the draft. " +
      (customerFirstName
        ? `If the draft greets the customer, address them by their first name, ${customerFirstName}. `
        : "The customer's name isn't known — if the draft greets them, keep the greeting generic (e.g. \"Hi there,\") rather than inventing a name. ") +
      "Reply with only the improved draft text, no preamble, no quotes, no explanation, and no sign-off " +
      "— the caller appends the sign-off separately.",
    prompt: `Ticket subject: ${ticketSubject}\nTicket body: ${ticketBody}\n\nAgent's draft reply:\n${draft}`,
  });
  return signReply(text.trim(), agentName);
}

// Drafts a reply from scratch, grounded only in the ticket's own subject/
// body — there's no agent draft yet to build on (that's polishReply,
// above). The model has no access to order/account/refund systems, so the
// prompt explicitly forbids inventing specifics it can't know, rather than
// risk a confident-sounding fabrication landing in an agent's outbox.
export async function generateReply({
  ticketSubject,
  ticketBody,
  customerName,
  agentName,
}: {
  ticketSubject: string;
  ticketBody: string;
  customerName: string | null;
  agentName: string;
}): Promise<string> {
  const customerFirstName = firstNameOf(customerName);
  const { text } = await generateText({
    model,
    system:
      "You help a customer support agent by drafting a first reply to a support ticket, for the agent to " +
      "review, edit, and send. Be professional, empathetic, and concise. You have no access to the " +
      "requester's order/account/refund details, so never invent specific facts (order status, refund " +
      "amounts, dates) — acknowledge the request and, where a concrete answer would require account access, " +
      "say the agent will look into it, rather than fabricating one. " +
      (customerFirstName
        ? `Open by addressing the customer by their first name only, ${customerFirstName} (e.g. "Hi ${customerFirstName},"). `
        : 'The customer\'s name isn\'t known — open with a generic greeting (e.g. "Hi there,") rather than inventing a name. ') +
      "Reply with only the draft reply text, no preamble, no quotes, no explanation, and no sign-off " +
      "— the caller appends the sign-off separately.",
    prompt: `Ticket subject: ${ticketSubject}\nTicket body: ${ticketBody}`,
  });
  return signReply(text.trim(), agentName);
}

// For an agent's own eyes (a "catch me up" tool), not the customer — no
// greeting, no sign-off, no signReply. Deliberately regenerated on every
// call rather than cached/persisted: the reply thread can grow between
// clicks, and a stale summary would be worse than a slightly redundant
// fresh one.
export async function summarizeTicket({
  ticketSubject,
  ticketBody,
  replies,
}: {
  ticketSubject: string;
  ticketBody: string;
  replies: { senderType: string; authorName: string; body: string }[];
}): Promise<string> {
  const transcript =
    replies.length === 0
      ? "(no replies yet)"
      : replies.map((r) => `[${r.senderType}] ${r.authorName}: ${r.body}`).join("\n\n");
  const { text } = await generateText({
    model,
    system:
      "You help a customer support agent quickly catch up on a ticket. Summarize, in a few concise " +
      "sentences or short bullet points: what the customer originally reported, and what's happened in " +
      "the reply thread since (attempts made, information exchanged, current state of the conversation). " +
      "This is an internal note for the agent, not a message to the customer — no greeting, no sign-off, " +
      "don't address anyone by name. Reply with only the summary, no preamble, no explanation.",
    prompt: `Ticket subject: ${ticketSubject}\nTicket body: ${ticketBody}\n\nReply thread (oldest first):\n${transcript}`,
  });
  return text.trim();
}

// Prisma's own TicketCategory (not core's client-safe re-declaration —
// this file is server-only, see CLAUDE.md's "Core enums" section), so
// adding a category here can never drift from what the DB column actually
// accepts.
const CATEGORY_VALUES = Object.values(TicketCategory) as [TicketCategory, ...TicketCategory[]];

// generateObject's "enum" output mode, rather than generateText + parsing —
// the model is constrained to return one of exactly these three strings,
// no free text to validate or coerce. There's no "Other"/unclassified
// option, matching TicketCategory itself (project-scope.md's "Categories"
// decision is exactly these three, exhaustively) — the model always has to
// pick its single best fit rather than punt.
export async function classifyTicket({
  ticketSubject,
  ticketBody,
}: {
  ticketSubject: string;
  ticketBody: string;
}): Promise<TicketCategory> {
  const { object } = await generateObject({
    model,
    output: "enum",
    enum: CATEGORY_VALUES,
    system:
      "Classify this customer support ticket into exactly one category, based on its subject and body:\n" +
      "- GENERAL_QUESTION: a general question that isn't a technical problem or a refund request.\n" +
      "- TECHNICAL_QUESTION: a bug, error, or something not working as expected.\n" +
      "- REFUND_REQUEST: the customer is asking for a refund, credit, or their money back.\n" +
      "Pick the single best-fitting category, even if the ticket could arguably fit more than one.",
    prompt: `Ticket subject: ${ticketSubject}\nTicket body: ${ticketBody}`,
  });
  return object;
}
