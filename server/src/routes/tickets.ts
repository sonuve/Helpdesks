import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createReplySchema, polishReplySchema } from "core";
import { generateReply, polishReply } from "../lib/reply-drafting.js";
import { summarizeTicket } from "../lib/ticket-analysis.js";
import { prisma } from "../lib/prisma.js";
import { enqueueAutoResolveTicket, enqueueClassifyTicket } from "../lib/queue.js";
import { computeAverageResolutionTimeMs, computeResolvedByAiPercent } from "../lib/ticket-stats.js";
import { apiLimiter } from "../middleware/rate-limit.js";
import type { Prisma } from "../generated/prisma/client.js";
// Prisma's own generated TicketStatus/TicketCategory, not core's
// re-declaration — the server already has direct access to the
// authoritative source, so importing core's client-safe copy here would
// just be an unnecessary indirection. Same reasoning as lib/auth.ts using
// Prisma's own Role instead of core's. core's copies exist for the
// client, which can't reach this generated output — see CLAUDE.md's
// "Core enums" section.
import { ReplySenderType, TicketCategory, TicketStatus } from "../generated/prisma/enums.js";

export const ticketsRouter = Router();

// Query-string shape, not a client form — the client (TicketsTable.tsx)
// derives these from TanStack Table's sorting state and its filter
// dropdowns rather than validating them itself, so per CLAUDE.md's
// data-validation convention this stays local here rather than moving to
// `core`. The sortBy allow-list exists because this is a real HTTP query
// param any caller can set — without it, an arbitrary field name would
// reach Prisma's `orderBy`.
const listTicketsQuerySchema = z
  .object({
    sortBy: z
      .enum(["id", "subject", "requesterEmail", "status", "category", "createdAt"])
      .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    status: z.nativeEnum(TicketStatus).optional(),
    // "UNCLASSIFIED" is a sentinel, not a real TicketCategory value — a
    // query param can't express "category is null" any other way, and
    // z.nativeEnum(TicketCategory) alone can't match it.
    category: z.union([z.nativeEnum(TicketCategory), z.literal("UNCLASSIFIED")]).optional(),
    // 1-indexed, matching how it's shown in the UI ("Page 1 of N") — the
    // conversion to Prisma's 0-indexed `skip` happens below, not in the
    // param itself. Capped at 100 so a caller can't force-load the entire
    // table in one page.
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    // Plain "YYYY-MM-DD" from the client's <input type="date">. z.coerce.date()
    // parses that as UTC midnight; createdTo is expanded to the end of that
    // day below (see endOfDay) so the filter is inclusive of the whole day,
    // not just its first instant.
    createdFrom: z.coerce.date({ invalid_type_error: "createdFrom must be a valid date" }).optional(),
    createdTo: z.coerce.date({ invalid_type_error: "createdTo must be a valid date" }).optional(),
  })
  .refine((data) => !data.createdFrom || !data.createdTo || data.createdFrom <= data.createdTo, {
    message: "createdFrom must be on or before createdTo",
    path: ["createdFrom"],
  });

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

// Unlike server/src/routes/users.ts, this isn't ADMIN-only: per
// project-scope.md's "Agent permissions" decision, regular agents have
// full ticket control (claim, reassign, close/reopen, etc.), not just
// admins, so any authenticated user can list tickets.
ticketsRouter.get("/api/tickets", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = listTicketsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { sortBy, sortOrder, status, category, page, pageSize, createdFrom, createdTo } =
    parsed.data;

  // Filtering happens here too, for the same reason as sorting: the client
  // sends status/category/createdFrom/createdTo as query params and
  // renders the (already filtered) response as-is, rather than filtering a
  // fully-loaded page itself.
  const where: Prisma.TicketWhereInput = {
    ...(status ? { status } : {}),
    ...(category === "UNCLASSIFIED" ? { category: null } : category ? { category } : {}),
    ...(createdFrom || createdTo
      ? {
          createdAt: {
            ...(createdFrom ? { gte: createdFrom } : {}),
            ...(createdTo ? { lte: endOfDay(createdTo) } : {}),
          },
        }
      : {}),
    // Tickets an AI auto-resolve job (lib/queue.ts) resolved on its own
    // are excluded from the default (no explicit status filter) view —
    // per project-scope.md's "AI autonomy" decision, they shouldn't
    // clutter the list an agent actually works from. Only when a status
    // filter is unset: an explicit `status=RESOLVED` (or any other status)
    // is a deliberate ask and returns them normally — nothing here is
    // truly invisible, just off by default.
    ...(status ? {} : { resolvedByAi: false }),
  };

  // Pagination happens here as well: the client only ever holds one page
  // of tickets at a time, not the full (filtered) table, and asks the
  // server for `total` to know how many pages exist.
  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ticket.count({ where }),
  ]);

  res.json({ tickets, total, page, pageSize });
});

// Registered before GET /api/tickets/:id — Express matches routes in
// registration order, and "/api/tickets/stats" also matches that route's
// :id param (it'd 400 as "Invalid ticket id" if this were registered
// after it), so the literal path has to come first. Same access rule as
// every other ticket endpoint: any authenticated user, not just admins.
ticketsRouter.get("/api/tickets/stats", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const [totalTickets, openTickets, resolvedByAiCount, resolvedTickets] = await Promise.all([
    prisma.ticket.count(),
    prisma.ticket.count({ where: { status: TicketStatus.OPEN } }),
    prisma.ticket.count({ where: { resolvedByAi: true } }),
    // Only createdAt/resolvedAt are needed to compute the average, not the
    // whole row — resolvedAt (not updatedAt) is what actually marks when a
    // ticket left OPEN, see its comment in schema.prisma. The `where`
    // narrows the query for efficiency; computeAverageResolutionTimeMs
    // (lib/ticket-stats.ts) still filters resolvedAt itself too, so it
    // stays correct even called with unfiltered rows elsewhere.
    prisma.ticket.findMany({
      where: { resolvedAt: { not: null } },
      select: { createdAt: true, resolvedAt: true },
    }),
  ]);

  res.json({
    totalTickets,
    openTickets,
    resolvedByAiCount,
    resolvedByAiPercent: computeResolvedByAiPercent(resolvedByAiCount, totalTickets),
    averageResolutionTimeMs: computeAverageResolutionTimeMs(resolvedTickets),
  });
});

// Same access rule as the list endpoint above: any authenticated user, not
// just admins.
ticketsRouter.get("/api/tickets/:id", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Ticket.id is a numeric autoincrement (unlike User.id), so a
  // non-numeric :id segment is a 400, not just a 404.
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: "Invalid ticket id" });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: id.data },
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
      // Oldest first, matching how a chronological reply thread reads.
      replies: {
        include: { author: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  res.json({ ticket });
});

// Two independently-optional fields (a client can change just status, just
// category, or both in one request) with no real multi-field form behind
// them — same reasoning as assignTicketSchema below for staying local
// rather than moving to `core`. `category` is nullable *and* optional:
// omitted means "leave it alone," explicit `null` means "clear it back to
// unclassified" (overriding an AI classification, per project-scope.md's
// "Agent permissions" decision) — `status` has no such "unset" state, a
// ticket always has one.
const updateTicketSchema = z
  .object({
    status: z.nativeEnum(TicketStatus).optional(),
    category: z.nativeEnum(TicketCategory).nullable().optional(),
  })
  .refine((data) => data.status !== undefined || data.category !== undefined, {
    message: "At least one of status or category must be provided",
  });

// Same access rule as the other ticket endpoints: any authenticated user,
// not just admins — project-scope.md's "Agent permissions" decision gives
// regular agents full status/category control (close/reopen, override AI
// classification), not just admins.
ticketsRouter.patch("/api/tickets/:id", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: "Invalid ticket id" });
  }

  const parsed = updateTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { status, category } = parsed.data;

  const existing = await prisma.ticket.findUnique({ where: { id: id.data } });
  if (!existing) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const now = new Date();
  // Ticket.resolvedAt tracks the first time this ticket left OPEN, separate
  // from updatedAt (which every kind of activity bumps — a reply, a
  // reassignment, a category change) — see its comment in schema.prisma.
  // Reopening to OPEN clears it; moving between two non-OPEN statuses (e.g.
  // RESOLVED -> CLOSED) leaves the original resolution time alone rather
  // than resetting the clock.
  let resolvedAt: Date | null | undefined;
  if (status === TicketStatus.OPEN) {
    resolvedAt = null;
  } else if (status !== undefined && existing.status === TicketStatus.OPEN) {
    resolvedAt = now;
  }

  const ticket = await prisma.ticket.update({
    where: { id: id.data },
    data: {
      ...(status !== undefined ? { status } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(resolvedAt !== undefined ? { resolvedAt } : {}),
      updatedAt: now,
    },
    include: { assignedTo: { select: { id: true, name: true, email: true } } },
  });

  res.json({ ticket });
});

// A single trivial field with no real form behind it (the client drives it
// straight from a Select's onChange, not a validated multi-field form), so
// per CLAUDE.md's data-validation convention this stays local rather than
// moving to `core`. `null` means "unassign" — `min(1)` rejects `""` as a
// distinct, meaningless third value (not a real user id, and not the
// explicit `null` this endpoint requires for unassigning).
const assignTicketSchema = z.object({
  assignedToId: z.string().min(1, "assignedToId must not be empty").nullable(),
});

// Same access rule as the other ticket endpoints: any authenticated user,
// not just admins — project-scope.md's "Agent permissions" decision gives
// regular agents full reassignment rights, not just the current assignee
// or an admin.
ticketsRouter.patch("/api/tickets/:id/assign", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: "Invalid ticket id" });
  }

  const parsed = assignTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { assignedToId } = parsed.data;

  const existing = await prisma.ticket.findUnique({ where: { id: id.data } });
  if (!existing) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  // `!== null` rather than a truthy check — schema validation already
  // rejects `""`, but this must still hold even if that changes, since a
  // truthy check would let an empty string skip the existence lookup and
  // reach Prisma, where it would fail as an opaque FK-constraint 500
  // instead of a clean 404.
  if (assignedToId !== null) {
    const assignee = await prisma.user.findUnique({ where: { id: assignedToId } });
    if (!assignee || assignee.deletedAt) {
      return res.status(404).json({ error: "Assignee not found" });
    }
  }

  const ticket = await prisma.ticket.update({
    where: { id: id.data },
    data: { assignedToId, updatedAt: new Date() },
    include: { assignedTo: { select: { id: true, name: true, email: true } } },
  });

  res.json({ ticket });
});

// Same access rule as every other ticket endpoint: any authenticated user,
// not just admins. This only records an internal reply on the ticket's
// thread — actually sending it out as an email is implementation-plan.md's
// Phase 3 "Manual reply" task, blocked on the same email-provider decision
// as ingestion (see project-scope.md's "Email ingestion" open question).
ticketsRouter.post("/api/tickets/:id/replies", apiLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: "Invalid ticket id" });
  }

  const parsed = createReplySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const existing = await prisma.ticket.findUnique({ where: { id: id.data } });
  if (!existing) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  const now = new Date();
  const reply = await prisma.ticketReply.create({
    data: {
      ticketId: id.data,
      authorId: req.user.id,
      // Hardcoded, not read from the request body: every caller here is a
      // signed-in agent (the auth check above), so the server — not the
      // client — decides senderType. There's no customer-facing reply path
      // yet to produce a CUSTOMER-sender row.
      senderType: ReplySenderType.AGENT,
      body: parsed.data.body,
      createdAt: now,
    },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
  // A reply is activity on the ticket, same as a status/category/assignment
  // change — keep updatedAt consistent with those.
  await prisma.ticket.update({ where: { id: id.data }, data: { updatedAt: now } });

  res.status(201).json({ reply });
});

// Improves an agent's in-progress draft before they send it — distinct
// from POST /api/tickets/:id/replies, which actually creates the
// TicketReply. Nothing is persisted here; the client swaps the polished
// text into its own form state and the agent still has to hit "Send
// reply" themselves. Same req.user-only access rule as every other ticket
// endpoint.
ticketsRouter.post(
  "/api/tickets/:id/polish-reply",
  apiLimiter,
  async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }

    const parsed = polishReplySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }

    const ticket = await prisma.ticket.findUnique({ where: { id: id.data } });
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    // Unlike the rest of this file, a failure here is an external AI
    // provider being unreachable/erroring/misconfigured, not a Prisma/zod
    // error — that's worth a specific response (same reasoning as
    // GET /api/health's try/catch) rather than the default 500 from
    // letting it propagate.
    try {
      const polished = await polishReply({
        ticketSubject: ticket.subject,
        ticketBody: ticket.body,
        customerName: ticket.requesterName,
        draft: parsed.data.body,
        agentName: req.user.name,
      });
      res.json({ body: polished });
    } catch (error) {
      console.error("[polish-reply] AI request failed:", error);
      res.status(502).json({ error: "Could not polish this reply. Please try again." });
    }
  },
);

// Drafts a reply from scratch, grounded in the ticket itself rather than an
// agent's in-progress text — for when there's no draft yet to polish. Same
// "nothing persisted, req.user-only" shape as polish-reply above; no
// request body to validate since the ticket's own subject/body is the only
// input.
ticketsRouter.post(
  "/api/tickets/:id/generate-reply",
  apiLimiter,
  async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }

    const ticket = await prisma.ticket.findUnique({ where: { id: id.data } });
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    try {
      const generated = await generateReply({
        ticketSubject: ticket.subject,
        ticketBody: ticket.body,
        customerName: ticket.requesterName,
        agentName: req.user.name,
      });
      res.json({ body: generated });
    } catch (error) {
      console.error("[generate-reply] AI request failed:", error);
      res.status(502).json({ error: "Could not generate a reply. Please try again." });
    }
  },
);

// An agent-facing "catch me up" summary of the ticket and its reply thread
// so far — not persisted anywhere (see lib/ticket-analysis.ts's summarizeTicket), so the
// client is expected to call this again whenever it wants a current one
// rather than relying on a cached result. Same req.user-only, no-request-
// body shape as generate-reply above.
ticketsRouter.post(
  "/api/tickets/:id/summarize",
  apiLimiter,
  async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: id.data },
      include: {
        replies: {
          include: { author: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    try {
      const summary = await summarizeTicket({
        ticketSubject: ticket.subject,
        ticketBody: ticket.body,
        replies: ticket.replies.map((reply) => ({
          senderType: reply.senderType,
          authorName: reply.author.name,
          body: reply.body,
        })),
      });
      res.json({ summary });
    } catch (error) {
      console.error("[summarize] AI request failed:", error);
      res.status(502).json({ error: "Could not summarize this ticket. Please try again." });
    }
  },
);

// Validates a webhook-shaped request body, not a client form — there's no
// UI behind this endpoint, so per CLAUDE.md's data-validation convention
// this stays local here rather than moving to `core`.
const receiveEmailSchema = z.object({
  from: z.string().email("A valid sender email is required"),
  // Optional: not every email provider surfaces a display name alongside
  // the address, and this is a display-only nicety (see
  // Ticket.requesterName in schema.prisma) — never required to accept the
  // ticket.
  requesterName: z.string().trim().min(1).optional(),
  subject: z.string().trim().default("(no subject)"),
  body: z.string(),
});

// Simulates "an email arrived at the support address" until a real
// provider (Gmail API / Microsoft Graph / an inbound-parse webhook — see
// project-scope.md's "Email ingestion" open question) is wired up to call
// this. Gated by a shared secret rather than req.user: the real caller
// will be a provider's webhook, not a signed-in browser session, so this
// stands in for that until provider-specific signature verification
// replaces it.
ticketsRouter.post("/api/tickets", apiLimiter, async (req: Request, res: Response) => {
  const expectedSecret = process.env.EMAIL_INGEST_SECRET;
  // Fail closed if the secret isn't configured — never treat a missing
  // env var as "no check needed."
  if (!expectedSecret || req.header("x-ingest-secret") !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = receiveEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const now = new Date();
  const ticket = await prisma.ticket.create({
    data: {
      subject: parsed.data.subject,
      body: parsed.data.body,
      requesterEmail: parsed.data.from.toLowerCase(),
      requesterName: parsed.data.requesterName ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });

  // Enqueues classification rather than running it inline — this awaits a
  // fast pg-boss insert, not the AI call itself (see lib/queue.ts), so the
  // webhook still responds without waiting on Gemini, matching
  // tech-stack.md's rationale for keeping ingestion handlers fast (the
  // full system does this via a BullMQ job; pg-boss is the same
  // non-blocking, durable outcome on the Postgres this codebase already
  // has, no Redis needed — see CLAUDE.md's "Ticket classification"). The
  // response's `ticket.category` is still `null`; callers reading the
  // category back need a subsequent GET once the queued job completes.
  await enqueueClassifyTicket(ticket);
  // Same non-blocking shape, separate job/queue: whether a ticket gets
  // auto-resolved is independent of its category, so these run as two
  // parallel jobs rather than one chained pipeline.
  await enqueueAutoResolveTicket(ticket);

  res.status(201).json({ ticket });
});
