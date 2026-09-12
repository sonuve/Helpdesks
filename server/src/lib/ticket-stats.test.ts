import { describe, expect, test } from "bun:test";
import {
  computeAverageResolutionTimeMs,
  computeResolvedByAiPercent,
  computeTicketsPerDay,
} from "./ticket-stats.js";

describe("computeResolvedByAiPercent", () => {
  test("returns 0 when there are no tickets at all, rather than NaN", () => {
    expect(computeResolvedByAiPercent(0, 0)).toBe(0);
  });

  test("computes a 0-100 percentage, not a 0-1 ratio", () => {
    expect(computeResolvedByAiPercent(1, 4)).toBe(25);
  });

  test("returns 0 when nothing has been resolved by AI yet", () => {
    expect(computeResolvedByAiPercent(0, 10)).toBe(0);
  });

  test("returns 100 when every ticket was resolved by AI", () => {
    expect(computeResolvedByAiPercent(3, 3)).toBe(100);
  });
});

describe("computeAverageResolutionTimeMs", () => {
  test("returns null when there are no tickets", () => {
    expect(computeAverageResolutionTimeMs([])).toBeNull();
  });

  test("returns null when no ticket has a resolvedAt yet", () => {
    const result = computeAverageResolutionTimeMs([
      { createdAt: new Date("2026-01-01T00:00:00Z"), resolvedAt: null },
    ]);
    expect(result).toBeNull();
  });

  test("returns the exact elapsed time for a single resolved ticket", () => {
    const result = computeAverageResolutionTimeMs([
      {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        resolvedAt: new Date("2026-01-01T01:00:00Z"),
      },
    ]);
    expect(result).toBe(60 * 60 * 1000);
  });

  test("averages across multiple resolved tickets", () => {
    const result = computeAverageResolutionTimeMs([
      {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        resolvedAt: new Date("2026-01-01T01:00:00Z"), // 1 hour
      },
      {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        resolvedAt: new Date("2026-01-01T03:00:00Z"), // 3 hours
      },
    ]);
    expect(result).toBe(2 * 60 * 60 * 1000); // average: 2 hours
  });

  test("ignores unresolved tickets mixed in with resolved ones", () => {
    const result = computeAverageResolutionTimeMs([
      {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        resolvedAt: new Date("2026-01-01T02:00:00Z"), // 2 hours
      },
      { createdAt: new Date("2026-01-01T00:00:00Z"), resolvedAt: null },
    ]);
    expect(result).toBe(2 * 60 * 60 * 1000);
  });
});

describe("computeTicketsPerDay", () => {
  // Fixed reference point rather than the real current time, so every
  // test here is deterministic regardless of when it actually runs.
  const NOW = new Date("2026-01-10T15:30:00Z");

  test("returns one zero-count entry per day when there are no tickets", () => {
    const result = computeTicketsPerDay([], 5, NOW);

    expect(result).toEqual([
      { date: "2026-01-06", count: 0 },
      { date: "2026-01-07", count: 0 },
      { date: "2026-01-08", count: 0 },
      { date: "2026-01-09", count: 0 },
      { date: "2026-01-10", count: 0 },
    ]);
  });

  test("orders days oldest first, ending on now's own calendar day", () => {
    const result = computeTicketsPerDay([], 3, NOW);
    expect(result.map((d) => d.date)).toEqual(["2026-01-08", "2026-01-09", "2026-01-10"]);
  });

  test("counts multiple tickets created on the same UTC day together", () => {
    const result = computeTicketsPerDay(
      [
        { createdAt: new Date("2026-01-09T01:00:00Z") },
        { createdAt: new Date("2026-01-09T23:59:00Z") },
        { createdAt: new Date("2026-01-10T00:00:00Z") },
      ],
      3,
      NOW,
    );

    expect(result).toEqual([
      { date: "2026-01-08", count: 0 },
      { date: "2026-01-09", count: 2 },
      { date: "2026-01-10", count: 1 },
    ]);
  });

  test("excludes a ticket created outside the requested window", () => {
    const result = computeTicketsPerDay(
      [{ createdAt: new Date("2026-01-01T00:00:00Z") }], // 9 days before the 3-day window starts
      3,
      NOW,
    );

    expect(result.every((d) => d.count === 0)).toBe(true);
  });
});
