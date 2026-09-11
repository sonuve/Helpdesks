import { PgBoss } from "pg-boss";
import { classifyTicket } from "./ai.js";
import { prisma } from "./prisma.js";
import type { Ticket } from "../generated/prisma/client.js";

const CLASSIFY_TICKET_QUEUE = "classify-ticket";

type ClassifyTicketJob = { ticketId: number; subject: string; body: string };

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

export async function startQueue(): Promise<void> {
  await boss.start();
  await boss.createQueue(CLASSIFY_TICKET_QUEUE);
  await boss.work<ClassifyTicketJob>(CLASSIFY_TICKET_QUEUE, processClassifyTicketJobs);
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
