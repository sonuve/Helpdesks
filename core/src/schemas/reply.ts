import { z } from "zod";

// Mirrors server/src/generated/prisma/enums.ts's `ReplySenderType` (a
// Prisma-generated const object, not a native `enum` — see `Role` in
// user.ts for why). Defined again here, rather than imported from the
// Prisma output, because `core` — and by extension `client` — must never
// depend on server-only generated code.
export const ReplySenderType = {
  AGENT: "AGENT",
  CUSTOMER: "CUSTOMER",
} as const;

export type ReplySenderType = (typeof ReplySenderType)[keyof typeof ReplySenderType];

// senderType isn't part of this: it's set by the server from who's
// authenticated (POST /api/tickets/:id/replies hardcodes AGENT), never
// taken from client input — see schema.prisma's TicketReply comment.
export const createReplySchema = z.object({
  body: z.string().trim().min(1, "Reply cannot be empty"),
});

export type CreateReplyInput = z.infer<typeof createReplySchema>;
