import { describe, expect, test } from "bun:test";
import { computeAverageResolutionTimeMs, computeResolvedByAiPercent } from "./ticket-stats.js";

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
