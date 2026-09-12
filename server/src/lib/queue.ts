import { PgBoss } from "pg-boss";
import { getOrCreateAiAssistantUser } from "./ai-assistant.js";
import { classifyTicket, evaluateAutoResolution } from "./ticket-analysis.js";
import { prisma } from "./prisma.js";
import type { Ticket } from "../generated/prisma/client.js";
import { ReplySenderType, TicketStatus } from "../generated/prisma/enums.js";

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

// Processes a batch of auto-resolve-ticket jobs — same per-job try/catch
// shape as processClassifyTicketJobs above, and the same reason for it.
// Each ticket is assigned to the AI agent for the duration of the
// evaluation (mirroring a human agent claiming a ticket, and making it
// visible in the ticket list/detail that the AI is working it) — then
// either left assigned (resolved: the AI handled it) or handed back to the
// normal unassigned queue (not resolved, or the evaluation/transaction
// itself throws), so a ticket the AI couldn't help with never sits stuck
// "assigned" to an agent that isn't actually doing anything further with
// it. Unassigning uses `updateMany` with `assignedToId: aiAssistant.id` in
// its `where`, not a plain `update` by id — a human could reassign the
// ticket out from under this job while it's running, and that conditional
// guard makes sure this only ever clears its *own* assignment, never one a
// human made in the meantime.
export async function processAutoResolveTicketJobs(
  jobs: { id: string; data: AutoResolveTicketJob }[],
): Promise<void> {
  for (const job of jobs) {
    let aiAssistant: { id: string } | undefined;
    try {
      aiAssistant = await getOrCreateAiAssistantUser();
      await prisma.ticket.update({
        where: { id: job.data.ticketId },
        data: { assignedToId: aiAssistant.id },
      });

      const { resolvable, reply } = await evaluateAutoResolution({
        ticketSubject: job.data.subject,
        ticketBody: job.data.body,
        customerName: job.data.customerName,
      });
      if (!resolvable || !reply) {
        await prisma.ticket.updateMany({
          where: { id: job.data.ticketId, assignedToId: aiAssistant.id },
          data: { assignedToId: null },
        });
        continue;
      }

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
          data: {
            status: TicketStatus.RESOLVED,
            resolvedByAi: true,
            resolvedAt: now,
            updatedAt: now,
          },
        }),
      ]);
    } catch (error) {
      console.error(
        `[auto-resolve-ticket] job ${job.id} failed for ticket ${job.data.ticketId}:`,
        error,
      );
      // The AI call (or the reply/resolve transaction) failed partway
      // through — explicitly force the ticket back to OPEN, and off the
      // AI agent's plate, rather than trust whatever state it was already
      // in, so a failure here can never leave a ticket silently stuck out
      // of an agent's queue. Own try/catch so a failing update here still
      // doesn't stop the rest of the batch (same reasoning as the outer
      // per-job catch). Only touches assignedToId if this job actually got
      // as far as assigning it — no need to (and nothing to) unassign
      // otherwise, same conditional-unassign reasoning as above.
      try {
        await prisma.ticket.update({
          where: { id: job.data.ticketId },
          data: { status: TicketStatus.OPEN },
        });
        if (aiAssistant) {
          await prisma.ticket.updateMany({
            where: { id: job.data.ticketId, assignedToId: aiAssistant.id },
            data: { assignedToId: null },
          });
        }
      } catch (updateError) {
        console.error(
          `[auto-resolve-ticket] job ${job.id} failed to reset ticket ${job.data.ticketId} to OPEN:`,
          updateError,
        );
      }
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
