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
const listTicketsQuerySchema = z.object({
  sortBy: z
    .enum(["id", "subject", "requesterEmail", "status", "category", "createdAt"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  status: z.nativeEnum(TicketStatus).optional(),
  // "UNCLASSIFIED" is a sentinel, not a real TicketCategory value — a
  // query param can't express "category is null" any other way, and
  // z.nativeEnum(TicketCategory) alone can't match it.
  category: z.union([z.nativeEnum(TicketCategory), z.literal("UNCLASSIFIED")]).optional(),
});

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
  const { sortBy, sortOrder, status, category } = parsed.data;

  // Filtering happens here too, for the same reason as sorting: the client
  // sends status/category as query params and renders the (already
  // filtered) response as-is, rather than filtering a fully-loaded page
  // itself.
  const where: Prisma.TicketWhereInput = {
    ...(status ? { status } : {}),
    ...(category === "UNCLASSIFIED" ? { category: null } : category ? { category } : {}),
  };

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: { [sortBy]: sortOrder },
  });

  res.json({ tickets });
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
