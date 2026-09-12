import sgMail from "@sendgrid/mail";

// SendGrid's outbound Mail Send API — the send-side counterpart to
// routes/inbound-email.ts's Inbound Parse webhook (the receive side).
// These are two separate SendGrid packages/concerns: @sendgrid/inbound-mail-parser
// parses what SendGrid forwards to us on the way in;
// @sendgrid/mail is what actually calls SendGrid's API to send.
//
// Guarded rather than called unconditionally: sgMail.setApiKey() throws
// synchronously if handed a non-string, and SENDGRID_API_KEY is genuinely
// unset in some environments (server tests mock this module wholesale —
// see routes/tickets.test.ts and lib/queue.test.ts — rather than needing a
// real key). Leaving it unset here just means the .send() call below fails
// naturally (SendGrid's client requires setApiKey to have been called),
// which sendReplyEmail's callers already treat as a normal failure.
const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

export type ReplyEmail = {
  to: string;
  subject: string;
  text: string;
};

// Sends an agent's (or the AI assistant's) reply to the ticket's requester
// as a real outbound email — implementation-plan.md's Phase 2 "Manual
// reply" task ("proves the ingestion/send loop end-to-end"), now that
// project-scope.md's "Email ingestion provider" decision has settled on
// SendGrid for the receiving side too.
//
// Deliberately throws rather than swallowing a failure: this function
// doesn't decide what a failed send means — its two callers do.
// routes/tickets.ts's POST /api/tickets/:id/replies turns it into a 502
// before the reply is ever persisted (so a failed send never leaves a
// TicketReply row behind claiming something was sent that wasn't);
// lib/queue.ts's processAutoResolveTicketJobs lets it fall into the same
// catch block that already resets a failed evaluation back to OPEN and
// unassigned — a reply that can't be delivered is treated exactly like a
// judgment call that couldn't be made.
export async function sendReplyEmail(email: ReplyEmail): Promise<void> {
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    throw new Error("SendGrid is not configured — set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL.");
  }

  await sgMail.send({
    to: email.to,
    from: fromEmail,
    subject: email.subject,
    text: email.text,
  });
}
