import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { AI_ASSISTANT_NAME, classifyTicket, evaluateAutoResolution } from "./ai.js";
import { prisma } from "./prisma.js";
import type { Ticket } from "../generated/prisma/client.js";
import { ReplySenderType, Role, TicketStatus } from "../generated/prisma/enums.js";

const CLASSIFY_TICKET_QUEUE = "classify-ticket";
const AUTO_RESOLVE_TICKET_QUEUE = "auto-resolve-ticket";

type ClassifyTicketJob = { ticketId: number; subject: string; body: string };
type AutoResolveTicketJob = {
  ticketId: number;
  subject: string;
  body: string;
  customerName: string | null;
};

// One pg-boss instance per process, backed by the same Postgres database
// as everything else (same DATABASE_URL Prisma uses) — no separate Redis
// dependency for this, matching this codebase's existing preference (see
// CLAUDE.md's "Rate limiting": the rate_limit table over Redis, for the
// same reason). Must be started once (see startQueue, called from
// index.ts) before send()/work() do anything; app.ts itself stays
// side-effect-free for tests, same reasoning as it never calls
// app.listen() either.
const boss = new PgBoss(process.env.DATABASE_URL!);
boss.on("error", (error) => console.error("[pg-boss]", error));

// Processes a batch of classify-ticket jobs — exported separately from
// startQueue so it's directly testable without needing a real or heavily
// mocked PgBoss instance driving it. Each job is caught individually: one
// ticket's classification failing shouldn't fail the whole batch (pg-boss
// would otherwise mark every job in a rejected batch as failed).
export async function processClassifyTicketJobs(
  jobs: { id: string; data: ClassifyTicketJob }[],
): Promise<void> {
  for (const job of jobs) {
    try {
      const category = await classifyTicket({
        ticketSubject: job.data.subject,
        ticketBody: job.data.body,
      });
      await prisma.ticket.update({ where: { id: job.data.ticketId }, data: { category } });
    } catch (error) {
      console.error(
        `[classify-ticket] job ${job.id} failed for ticket ${job.data.ticketId}:`,
        error,
      );
    }
  }
}

// Fixed, well-known address — upserted lazily (on first use, from
// whichever job needs it first) rather than via prisma/seed.ts, so this
// works the same in every environment (dev, server tests, e2e) without a
// separate seed step. TicketReply.authorId still requires a real User (no
// customer-facing or AI-facing reply path exists at the schema level — see
// its own comment), so an autonomously-sent reply needs a real row to
// attribute itself to; "AI Assistant" is that row, `role: AGENT` since
// there's no more specific role, and it never gets an Account/credential
// since nothing ever needs to sign in as it.
const AI_ASSISTANT_EMAIL = "ai-assistant@internal.helpdesks";

async function getOrCreateAiAssistantUser() {
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

// Processes a batch of auto-resolve-ticket jobs — same per-job try/catch
// shape as processClassifyTicketJobs above, and the same reason for it.
// A ticket judged not resolvable (or one whose classification/generation
// otherwise fails) is simply left alone: no reply, no status change,
// exactly like today, so this can only ever resolve *more* tickets than
// the pre-AI baseline, never fewer.
export async function processAutoResolveTicketJobs(
  jobs: { id: string; data: AutoResolveTicketJob }[],
): Promise<void> {
  for (const job of jobs) {
    try {
      const { resolvable, reply } = await evaluateAutoResolution({
        ticketSubject: job.data.subject,
        ticketBody: job.data.body,
        customerName: job.data.customerName,
      });
      if (!resolvable || !reply) {
        continue;
      }

      const aiAssistant = await getOrCreateAiAssistantUser();
      const now = new Date();
      await prisma.$transaction([
        prisma.ticketReply.create({
          data: {
            ticketId: job.data.ticketId,
            authorId: aiAssistant.id,
            senderType: ReplySenderType.AGENT,
            body: reply,
            createdAt: now,
          },
        }),
        prisma.ticket.update({
          where: { id: job.data.ticketId },
          data: { status: TicketStatus.RESOLVED, resolvedByAi: true, updatedAt: now },
        }),
      ]);
    } catch (error) {
      console.error(
        `[auto-resolve-ticket] job ${job.id} failed for ticket ${job.data.ticketId}:`,
        error,
      );
    }
  }
}

export async function startQueue(): Promise<void> {
  await boss.start();
  await boss.createQueue(CLASSIFY_TICKET_QUEUE);
  await boss.work<ClassifyTicketJob>(CLASSIFY_TICKET_QUEUE, processClassifyTicketJobs);
  await boss.createQueue(AUTO_RESOLVE_TICKET_QUEUE);
  await boss.work<AutoResolveTicketJob>(AUTO_RESOLVE_TICKET_QUEUE, processAutoResolveTicketJobs);
}

// POST /api/tickets awaits this — a fast insert into pg-boss's own job
// table, not the AI call itself, which processClassifyTicketJobs runs
// later (possibly in a different process). That's what makes
// classification non-blocking: the webhook response doesn't wait on
// Gemini, only on a Postgres write. It's also durable in a way a bare
// fire-and-forget call wouldn't be — the job survives a server restart
// between this insert and the AI call actually running.
export async function enqueueClassifyTicket(ticket: Ticket): Promise<void> {
  await boss.send(CLASSIFY_TICKET_QUEUE, {
    ticketId: ticket.id,
    subject: ticket.subject,
    body: ticket.body,
  } satisfies ClassifyTicketJob);
}

// Same non-blocking/durable reasoning as enqueueClassifyTicket above —
// POST /api/tickets awaits the (fast) enqueue, never the AI judgment call
// or the reply it might send.
export async function enqueueAutoResolveTicket(ticket: Ticket): Promise<void> {
  await boss.send(AUTO_RESOLVE_TICKET_QUEUE, {
    ticketId: ticket.id,
    subject: ticket.subject,
    body: ticket.body,
    customerName: ticket.requesterName,
  } satisfies AutoResolveTicketJob);
}
