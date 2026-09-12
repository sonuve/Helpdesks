import { Router, type Request, type Response } from "express";
import multer from "multer";
// @sendgrid/inbound-mail-parser ships `export = Parse` (CommonJS), picked
// up as a default import via esModuleInterop (server/tsconfig.json).
import Parse from "@sendgrid/inbound-mail-parser";
import { apiLimiter } from "../middleware/rate-limit.js";
import { createTicketFromEmail, receiveEmailSchema } from "../lib/ticket-ingestion.js";

export const inboundEmailRouter = Router();

// SendGrid's Inbound Parse webhook always POSTs multipart/form-data — even
// a plain-text email with no attachments arrives that way — so the text
// fields need multipart parsing to reach req.body at all; app.ts's
// express.json() only handles application/json. Memory storage rather
// than disk: attachment persistence isn't implemented yet (see
// project-scope.md's "Email ingestion" open question), so any uploaded
// attachment files just get read into req.files and discarded, never
// written to disk.
const upload = multer();

// SendGrid can be configured to POST either parsed fields (from/subject/
// text/html as separate multipart fields — the default) or a single
// `email` field holding the entire raw MIME message ("POST the raw, full
// MIME message" in its settings, off by default). @sendgrid/inbound-mail-parser's
// Parse class has a getRawEmail() for the latter, but it's unusable here:
// it's backed by mailparser@2.x's MessageSplitter, which throws
// `TypeError: Attempted to assign to readonly property` under Bun (this
// project's runtime — see server/package.json's `dev`/`test` scripts) the
// moment it's constructed — a real, verified incompatibility, not a
// hypothetical edge case. So this route only supports the default parsed-
// fields mode; the raw-MIME option must stay unchecked in SendGrid's
// Inbound Parse settings for this endpoint to work. If SendGrid or that
// dependency ever fixes this, revisit adding raw-MIME support then.
const SENDGRID_PARSE_KEYS = ["from", "subject", "text", "html"];

// SendGrid's `from` field is a raw header string, e.g.
// `"Jane Doe" <jane@example.com>` or bare `jane@example.com` — not
// pre-split into a display name and address the way, say, mailparser's
// AddressObject would be.
function parseFromHeader(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<([^<>]+)>\s*$/);
  if (match) {
    return { email: match[2]!.trim(), name: match[1]?.trim() || null };
  }
  return { email: raw.trim(), name: null };
}

// The real "an email arrived at the support address" entry point, now that
// project-scope.md's "Email ingestion" open question has settled on
// SendGrid's Inbound Parse webhook (SendGrid receives mail sent to the
// configured address and forwards it here as an HTTP POST) rather than
// Gmail API/Microsoft Graph polling or generic IMAP. This only extracts
// sender/subject/body and hands off to the same ticket-creation path
// POST /api/tickets (routes/tickets.ts) uses —
// lib/ticket-ingestion.ts's createTicketFromEmail — rather than
// duplicating it; POST /api/tickets itself is unchanged and stays the
// generic/test-facing landing point. Reply-threading, attachment storage,
// and spam/phishing filtering remain open questions (see that same
// section).
//
// Gated by a shared secret in the URL path rather than a header: unlike
// POST /api/tickets, the caller here is SendGrid's own infrastructure
// posting to a single, fixed Destination URL configured in its dashboard —
// Inbound Parse has no support for custom headers or payload signing, so
// the secret has to live in the URL itself. Configure the Destination URL
// as https://<host>/api/email/inbound/<EMAIL_INGEST_SECRET>. Same
// fail-closed rule as POST /api/tickets: a missing env var is never
// treated as "no check needed."
inboundEmailRouter.post(
  "/api/email/inbound/:secret",
  apiLimiter,
  upload.any(),
  async (req: Request, res: Response) => {
    const expectedSecret = process.env.EMAIL_INGEST_SECRET;
    if (!expectedSecret || req.params.secret !== expectedSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Passed as a plain {body, files} object rather than `req` itself:
    // Parse's own ParseRequest#files is typed `any[]`, which doesn't match
    // Express.Request#files' real type (an array from upload.any(), but a
    // per-fieldname object from upload.fields() — a union multer's types
    // keep even though this route only ever uses .any()). We don't
    // support attachments regardless (see the comment on `upload` above),
    // so `files` is always empty here.
    const parser = new Parse({ keys: SENDGRID_PARSE_KEYS }, { body: req.body, files: [] });

    let payload: Record<string, unknown>;
    try {
      // keyValues() throws (reduce on an empty array) if none of
      // SENDGRID_PARSE_KEYS are present at all — a malformed/empty
      // payload should 400 below, not 500.
      payload = parser.keyValues();
    } catch {
      return res.status(400).json({ error: "Invalid input" });
    }

    let from: string | undefined;
    let requesterName: string | undefined;
    const fromHeader = typeof payload.from === "string" ? payload.from : undefined;
    if (fromHeader) {
      const parsedFrom = parseFromHeader(fromHeader);
      from = parsedFrom.email;
      requesterName = parsedFrom.name ?? undefined;
    }
    const subject = typeof payload.subject === "string" ? payload.subject : undefined;
    const body =
      typeof payload.text === "string"
        ? payload.text
        : typeof payload.html === "string"
          ? payload.html
          : "";

    const parsed = receiveEmailSchema.safeParse({ from, requesterName, subject, body });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }

    const ticket = await createTicketFromEmail(parsed.data);

    res.status(201).json({ ticket });
  },
);
