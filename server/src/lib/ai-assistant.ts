import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import { AI_ASSISTANT_NAME } from "./ticket-analysis.js";
import { Role } from "../generated/prisma/enums.js";

// Fixed, well-known address for the one "AI" agent — a real User row so
// TicketReply.authorId (no AI-facing reply path exists at the schema
// level — see its own comment in schema.prisma) and Ticket.assignedToId
// both have a real row to point at. `role: AGENT` since there's no more
// specific role, and it never gets an Account/credential since nothing
// ever needs to sign in as it. Its `name` is AI_ASSISTANT_NAME
// (lib/ticket-analysis.ts) — the same name evaluateAutoResolution signs
// its replies with — so the sent reply's sign-off always matches the row
// it's attributed to and the agent it's assigned to.
export const AI_ASSISTANT_EMAIL = "ai-assistant@internal.helpdesks";

// Upserted rather than assumed to already exist: prisma/seed.ts calls this
// once to create it up front for a fresh dev/prod database (so it's
// visible and assignable immediately, not just after the first ticket's
// auto-resolve job runs), but lib/queue.ts also calls it lazily on first
// use as a safety net for any environment that skipped seeding (server
// tests' helpdesk_test database included) — both are safe to call
// any number of times.
export async function getOrCreateAiAssistantUser() {
  const now = new Date();
  return prisma.user.upsert({
    where: { email: AI_ASSISTANT_EMAIL },
    update: {},
    create: {
      id: randomUUID(),
      name: AI_ASSISTANT_NAME,
      email: AI_ASSISTANT_EMAIL,
      emailVerified: true,
      role: Role.AGENT,
      createdAt: now,
      updatedAt: now,
    },
  });
}
