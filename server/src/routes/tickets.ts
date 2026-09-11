import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { apiLimiter } from "../middleware/rate-limit.js";
import type { Prisma } from "../generated/prisma/client.js";
// Prisma's own generated TicketStatus/TicketCategory, not core's
// re-declaration — the server already has direct access to the
// authoritative source, so importing core's client-safe copy here would
// just be an unnecessary indirection. Same reasoning as lib/auth.ts using
// Prisma's own Role instead of core's. core's copies exist for the
// client, which can't reach this generated output — see CLAUDE.md's
// "Core enums" section.
import { TicketCategory, TicketStatus } from "../generated/prisma/enums.js";

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
    include: { assignedTo: { select: { id: true, name: true, email: true } } },
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

  const ticket = await prisma.ticket.update({
    where: { id: id.data },
    data: {
      ...(status !== undefined ? { status } : {}),
      ...(category !== undefined ? { category } : {}),
      updatedAt: new Date(),
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

// Validates a webhook-shaped request body, not a client form — there's no
// UI behind this endpoint, so per CLAUDE.md's data-validation convention
// this stays local here rather than moving to `core`.
const receiveEmailSchema = z.object({
  from: z.string().email("A valid sender email is required"),
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
      createdAt: now,
      updatedAt: now,
    },
  });

  res.status(201).json({ ticket });
});
