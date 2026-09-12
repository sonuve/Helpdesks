import { generateObject, generateText } from "ai";
import { z } from "zod";
import { TicketCategory } from "../generated/prisma/enums.js";
import { firstNameOf, model, signReply, TONE_AND_FORMATTING_GUIDANCE } from "./reply-drafting.js";

// The one "agent" name evaluateAutoResolution's replies ever sign with —
// exported so lib/queue.ts's getOrCreateAiAssistantUser can create that
// same-named User row from this single source, rather than the two
// drifting apart if one is ever renamed without the other.
export const AI_ASSISTANT_NAME = "AI Assistant";

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

const autoResolutionSchema = z.object({
  resolvable: z.boolean(),
  // Only meaningful when resolvable is true — validated together with it
  // by evaluateAutoResolution below, since zod can't express "required
  // when this sibling is true" declaratively for generateObject's schema.
  reply: z.string().nullable(),
});

// Judges whether a *new* ticket (project-scope.md's "AI autonomy" decision:
// autonomous handling, no human review step, for tickets confident enough
// not to need one) can be fully and confidently answered with nothing but
// its own subject/body, and drafts that reply in the same call if so —
// one model call rather than a separate classify-then-draft round trip.
// Deliberately conservative: told to default to "not resolvable" whenever
// unsure, since the caller (lib/queue.ts) sends this reply and closes the
// ticket with no human ever reviewing it first, unlike generateReply's
// draft-for-a-human-to-edit flow.
export async function evaluateAutoResolution({
  ticketSubject,
  ticketBody,
  customerName,
}: {
  ticketSubject: string;
  ticketBody: string;
  customerName: string | null;
}): Promise<{ resolvable: boolean; reply: string | null }> {
  const customerFirstName = firstNameOf(customerName);
  const { object } = await generateObject({
    model,
    schema: autoResolutionSchema,
    system:
      "You decide whether a new customer support ticket can be fully and confidently resolved right " +
      "now, autonomously, with no human agent involved at all. Only mark it resolvable if you can give " +
      "a complete, accurate answer using nothing but the ticket's own subject and body — you have no " +
      "access to the customer's account, order, billing, or refund systems, so anything needing that " +
      "information (order status, refund processing, account-specific details) is NOT resolvable this " +
      "way. When genuinely unsure, mark it not resolvable — a human should always be the fallback, " +
      "never a guess. " +
      "If resolvable, write the complete reply in `reply`, with a natural opening greeting but no " +
      "sign-off (the caller appends that separately). " +
      TONE_AND_FORMATTING_GUIDANCE +
      (customerFirstName
        ? `Open by addressing the customer by their first name only, ${customerFirstName} (e.g. "Hi ${customerFirstName},"). `
        : 'The customer\'s name isn\'t known — open with a generic greeting (e.g. "Hi there,") rather than inventing a name. ') +
      "If not resolvable, set `reply` to null.",
    prompt: `Ticket subject: ${ticketSubject}\nTicket body: ${ticketBody}`,
  });
  // Belt-and-suspenders on top of the schema: a model that sets resolvable
  // but forgets reply (or the reverse) should never reach the caller as a
  // "yes, and here's junk" — treat it as "not resolvable" rather than
  // risk sending a null/empty reply and closing the ticket regardless.
  if (!object.resolvable || !object.reply?.trim()) {
    return { resolvable: false, reply: null };
  }
  return { resolvable: true, reply: signReply(object.reply.trim(), AI_ASSISTANT_NAME) };
}
