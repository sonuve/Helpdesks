// The dashboard's aggregate math lives here, as small pure functions
// (no Prisma, no Express), rather than inline in routes/tickets.ts's
// GET /api/tickets/stats handler — the route only ever has one row per
// ticket, from a live, shared, constantly-changing table, so asserting an
// exact expected number against it in a test is either flaky (another
// test file mutating the same rows mid-assertion) or circular (recomputing
// the same formula from a fresh query right before comparing). Pulling the
// arithmetic out into pure functions lets it be unit-tested with fixed,
// made-up input instead.

// Percentage of `total` that `part` represents, as a 0-100 number rather
// than a 0-1 ratio (so the client can render it directly). `total === 0`
// (no tickets at all yet) is 0, not NaN/Infinity from a division by zero.
export function computeResolvedByAiPercent(resolvedByAiCount: number, total: number): number {
  return total === 0 ? 0 : (resolvedByAiCount / total) * 100;
}

// Average time (in milliseconds) from a ticket's creation to its
// resolution, across every ticket that has one. Filters out
// `resolvedAt: null` tickets itself (rather than trusting the caller to
// have pre-filtered), so it stays correct even if a caller passes
// unfiltered rows. Returns null — not 0 or NaN — when there's nothing
// resolved yet, since "no data" and "resolved instantly" are different
// things the dashboard should render differently.
export function computeAverageResolutionTimeMs(
  tickets: { createdAt: Date; resolvedAt: Date | null }[],
): number | null {
  const resolved = tickets.filter(
    (t): t is { createdAt: Date; resolvedAt: Date } => t.resolvedAt !== null,
  );
  if (resolved.length === 0) {
    return null;
  }
  const totalMs = resolved.reduce(
    (sum, t) => sum + (t.resolvedAt.getTime() - t.createdAt.getTime()),
    0,
  );
  return totalMs / resolved.length;
}

// "YYYY-MM-DD", UTC — the wire format for a calendar day throughout this
// function, matching how the rest of the codebase treats date-only values
// (routes/tickets.ts's createdFrom/createdTo filtering parses the same
// plain YYYY-MM-DD string as UTC midnight).
function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Buckets `tickets` by the UTC calendar day they were created, returning
// exactly `days` entries — the most recent `days` calendar days including
// `now`'s own day, oldest first (matching every other "oldest first"
// ordering in this codebase, e.g. a reply thread) — so the dashboard's bar
// chart always has a fixed-width, zero-filled x-axis instead of skipping
// days with no tickets. `now` defaults to the real current time but takes
// an explicit override so this stays a pure, deterministically-testable
// function rather than one whose output depends on when the test happens
// to run.
export function computeTicketsPerDay(
  tickets: { createdAt: Date }[],
  days: number,
  now: Date = new Date(),
): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    const key = toUtcDateKey(ticket.createdAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const result: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
    );
    const key = toUtcDateKey(date);
    result.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return result;
}
