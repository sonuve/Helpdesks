import { z } from "zod";
import { prisma } from "./prisma.js";
import { enqueueAutoResolveTicket, enqueueClassifyTicket } from "./queue.js";
import type { Ticket } from "../generated/prisma/client.js";

// Validates a webhook-shaped input, not a client form — there's no UI
// behind either caller of this, so per CLAUDE.md's data-validation
// convention this stays local here rather than moving to `core`. Shared by
// POST /api/tickets (routes/tickets.ts, the generic/test-facing landing
// point) and POST /api/email/inbound/:secret (routes/inbound-email.ts, the
// real SendGrid Inbound Parse webhook — see project-scope.md's "Email
// ingestion provider" decision): both end up creating a ticket from this
// same {from, requesterName?, subject?, body} shape, just reached via two
// different wire formats (a small JSON body vs. SendGrid's multipart
// payload).
export const receiveEmailSchema = z.object({
  from: z.string().email("A valid sender email is required"),
  // Optional: not every email provider surfaces a display name alongside
  // the address, and this is a display-only nicety (see
  // Ticket.requesterName in schema.prisma) — never required to accept the
  // ticket.
  requesterName: z.string().trim().min(1).optional(),
  subject: z.string().trim().default("(no subject)"),
  body: z.string(),
});

export type ReceiveEmailInput = z.infer<typeof receiveEmailSchema>;

// Creates the ticket and kicks off its two independent, non-blocking jobs
// (classification, auto-resolution) — see CLAUDE.md's "Ticket
// classification"/"Ticket auto-resolution" for why these are queued
// rather than run inline. Pulled out of routes/tickets.ts so both ingestion
// routes call the same path instead of duplicating it.
export async function createTicketFromEmail(input: ReceiveEmailInput): Promise<Ticket> {
  const now = new Date();
  const ticket = await prisma.ticket.create({
    data: {
      subject: input.subject,
      body: input.body,
      requesterEmail: input.from.toLowerCase(),
      requesterName: input.requesterName ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });

  await enqueueClassifyTicket(ticket);
  // Same non-blocking shape, separate job/queue: whether a ticket gets
  // auto-resolved is independent of its category, so these run as two
  // parallel jobs rather than one chained pipeline.
  await enqueueAutoResolveTicket(ticket);

  return ticket;
}
