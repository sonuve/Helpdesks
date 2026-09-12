import { afterAll, describe, expect, test } from "bun:test";
import { prisma } from "./prisma.js";

// The dashboard's aggregate math used to live here as small pure functions
// (computeResolvedByAiPercent/computeAverageResolutionTimeMs/
// computeTicketsPerDay) so it could be unit-tested against fixed, made-up
// input instead of the live, shared `ticket` table. It's since moved into
// a stored function, get_ticket_stats() (added by the
// add_ticket_stats_function migration), so GET /api/tickets/stats
// (routes/tickets.ts) does one query instead of three counts + two
// findManys combined in JS — see that migration's SQL for the arithmetic
// itself.
//
// There's no calling a Postgres function with an in-memory array the way
// the old pure functions were called, so "fixed input" here means real
// rows this file creates and cleans up itself. `ticketsPerDay`'s bucketing
// can still be tested exactly: it's windowed by `days_back`/`as_of`, so
// pointing `as_of` at a deliberately far-past date no other suite's
// tickets could ever land on isolates it from the live table. totalTickets/
// openTickets/resolvedByAiCount/resolvedByAiPercent/averageResolutionTimeMs
// aren't windowed the same way — they're whole-table aggregates by design
// (see schema.prisma) — so unlike before, their 0/null edge cases (an empty
// table, nothing resolved yet) can't be reproduced in isolation against a
// database other tests are also writing to. routes/tickets.test.ts's own
// "GET /api/tickets/stats" describe covers those two the same way it
// always has: asserting the relationship (resolvedByAiPercent is genuinely
// derived from the two counts) rather than an exact expected value.
const createdTicketIds: number[] = [];

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
  await prisma.$disconnect();
});

async function createTicket(data: { createdAt: Date; requesterEmail: string }) {
  const ticket = await prisma.ticket.create({
    data: {
      subject: "ticket-stats.test.ts fixture",
      body: "Created to test get_ticket_stats()'s ticketsPerDay bucketing.",
      requesterEmail: data.requesterEmail,
      createdAt: data.createdAt,
      updatedAt: data.createdAt,
    },
  });
  createdTicketIds.push(ticket.id);
  return ticket;
}

type TicketStats = {
  totalTickets: number;
  openTickets: number;
  resolvedByAiCount: number;
  resolvedByAiPercent: number;
  averageResolutionTimeMs: number | null;
  ticketsPerDay: { date: string; count: number }[];
};

async function getTicketStats(daysBack: number, asOf: Date): Promise<TicketStats> {
  // Explicit casts: Prisma binds a plain JS number as `bigint`, which
  // Postgres won't implicitly narrow to the function's `integer` parameter.
  const rows = await prisma.$queryRaw<
    { stats: TicketStats }[]
  >`SELECT get_ticket_stats(${daysBack}::integer, ${asOf}::timestamptz) AS stats`;
  return rows[0]!.stats;
}

describe("get_ticket_stats()'s ticketsPerDay bucketing", () => {
  // 2019-06-*, far enough in the past that no other test file's fixture
  // tickets (all created with real "now" timestamps) could ever fall in
  // this window, and fixed rather than relative to today so this suite
  // stays deterministic regardless of when it runs.
  const AS_OF = new Date("2019-06-10T15:30:00Z");

  test("returns one zero-count entry per day when nothing was created in the window", async () => {
    const stats = await getTicketStats(5, AS_OF);

    expect(stats.ticketsPerDay).toEqual([
      { date: "2019-06-06", count: 0 },
      { date: "2019-06-07", count: 0 },
      { date: "2019-06-08", count: 0 },
      { date: "2019-06-09", count: 0 },
      { date: "2019-06-10", count: 0 },
    ]);
  });

  test("orders days oldest first, ending on as_of's own calendar day", async () => {
    const stats = await getTicketStats(3, AS_OF);
    expect(stats.ticketsPerDay.map((d) => d.date)).toEqual([
      "2019-06-08",
      "2019-06-09",
      "2019-06-10",
    ]);
  });

  test("counts multiple tickets created on the same UTC day together, and excludes tickets outside the window", async () => {
    await createTicket({
      createdAt: new Date("2019-06-09T01:00:00Z"),
      requesterEmail: "stats-fixture-a@example.com",
    });
    await createTicket({
      createdAt: new Date("2019-06-09T23:59:00Z"),
      requesterEmail: "stats-fixture-b@example.com",
    });
    await createTicket({
      createdAt: new Date("2019-06-10T00:00:00Z"),
      requesterEmail: "stats-fixture-c@example.com",
    });
    // 9 days before the 3-day window starts below — must not be counted.
    await createTicket({
      createdAt: new Date("2019-06-01T00:00:00Z"),
      requesterEmail: "stats-fixture-outside-window@example.com",
    });

    const stats = await getTicketStats(3, AS_OF);

    expect(stats.ticketsPerDay).toEqual([
      { date: "2019-06-08", count: 0 },
      { date: "2019-06-09", count: 2 },
      { date: "2019-06-10", count: 1 },
    ]);
  });
});

describe("get_ticket_stats()'s resolvedByAiPercent/averageResolutionTimeMs contract", () => {
  test("resolvedByAiPercent is a 0-100 percentage genuinely derived from resolvedByAiCount/totalTickets", async () => {
    const stats = await getTicketStats(1, new Date());

    expect(stats.resolvedByAiPercent).toBeCloseTo(
      (stats.resolvedByAiCount / stats.totalTickets) * 100,
      5,
    );
  });

  test("averageResolutionTimeMs is null or a non-negative number, never NaN", async () => {
    const stats = await getTicketStats(1, new Date());

    expect(
      stats.averageResolutionTimeMs === null ||
        (typeof stats.averageResolutionTimeMs === "number" && stats.averageResolutionTimeMs >= 0),
    ).toBe(true);
  });
});
