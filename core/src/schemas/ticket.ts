import { z } from "zod";

// Mirrors server/src/generated/prisma/enums.ts's `TicketStatus`/
// `TicketCategory` (Prisma-generated const objects, not native `enum`s —
// see `Role` in user.ts for why). Defined again here, rather than imported
// from the Prisma output, because `core` — and by extension `client` —
// must never depend on server-only generated code.
export const TicketStatus = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
} as const;

export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketCategory = {
  GENERAL_QUESTION: "GENERAL_QUESTION",
  TECHNICAL_QUESTION: "TECHNICAL_QUESTION",
  REFUND_REQUEST: "REFUND_REQUEST",
} as const;

export type TicketCategory = (typeof TicketCategory)[keyof typeof TicketCategory];

// The draft an agent has typed so far, sent to POST /api/tickets/:id/polish-reply
// for AI-assisted improvement — same non-empty-body shape as a real reply
// (createReplySchema, reply.ts), since an agent can't polish a blank draft
// either.
export const polishReplySchema = z.object({
  body: z.string().trim().min(1, "Reply cannot be empty"),
});

export type PolishReplyInput = z.infer<typeof polishReplySchema>;
