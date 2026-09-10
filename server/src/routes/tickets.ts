import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { apiLimiter } from "../middleware/rate-limit.js";

export const ticketsRouter = Router();

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
