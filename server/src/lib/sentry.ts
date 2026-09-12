import * as Sentry from "@sentry/node";

// Called once from index.ts, before app.listen() — never from app.ts,
// which stays side-effect-free for tests (same reasoning it never calls
// app.listen()/startQueue() either — see lib/queue.ts's startQueue).
//
// Error tracking only, not performance tracing (tracesSampleRate: 0):
// @sentry/node's tracing/auto-instrumentation (span creation for Express,
// Prisma, outgoing HTTP, etc.) relies on Node's module-loader hooks
// (OpenTelemetry via import-in-the-middle), which Bun — this project's
// runtime, see server/package.json's dev/start/test scripts — doesn't
// support the same way Node does. What this codebase actually uses —
// manual Sentry.captureException calls (see queue.ts, routes/tickets.ts)
// and setupExpressErrorHandler (a plain Express middleware, not dependent
// on that instrumentation) — both work fine under Bun regardless; verified
// directly before wiring this in, the same way this codebase already had
// to for @sendgrid/inbound-mail-parser's raw-MIME path (see the comment on
// SENDGRID_PARSE_KEYS in routes/inbound-email.ts for that precedent).
//
// A missing/empty SENTRY_DSN makes Sentry.init() a documented no-op (logs
// one warning, disables the SDK) rather than something this file needs to
// special-case — every call this codebase makes into the SDK
// (captureException, setupExpressErrorHandler) is already safe to make
// against a disabled/uninitialized client, which is also what lets
// routes/tickets.ts and lib/queue.ts call Sentry.captureException directly
// with no test-time mocking: server tests never call initSentry() at all
// (only index.ts does), and the SDK no-ops safely either way.
export function initSentry(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}

export { Sentry };
