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
