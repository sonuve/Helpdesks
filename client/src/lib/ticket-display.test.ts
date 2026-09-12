import { describe, expect, it } from "vitest";
import { formatChartDate, formatDuration } from "./ticket-display.ts";

describe("formatDuration", () => {
  it("renders under an hour as minutes only", () => {
    expect(formatDuration(45 * 60_000)).toBe("45m");
  });

  it("renders whole hours with no trailing minutes", () => {
    expect(formatDuration(3 * 60 * 60_000)).toBe("3h");
  });

  it("renders hours and minutes together", () => {
    expect(formatDuration(2 * 60 * 60_000 + 30 * 60_000)).toBe("2h 30m");
  });

  it("renders whole days with no trailing hours", () => {
    expect(formatDuration(2 * 24 * 60 * 60_000)).toBe("2d");
  });

  it("renders days and hours together", () => {
    expect(formatDuration(1 * 24 * 60 * 60_000 + 5 * 60 * 60_000)).toBe("1d 5h");
  });

  it("rounds to the nearest minute", () => {
    expect(formatDuration(89_500)).toBe("1m"); // 1 minute, 29.5 seconds
  });
});

describe("formatChartDate", () => {
  it("renders a single-digit day with no leading zero", () => {
    expect(formatChartDate("2026-01-09")).toBe("Jan 9");
  });

  it("renders a double-digit day as-is", () => {
    expect(formatChartDate("2026-12-25")).toBe("Dec 25");
  });

  it("treats the date as UTC, not the local timezone", () => {
    // A date string of exactly midnight UTC could shift to the previous
    // day in a timezone behind UTC if this weren't handled explicitly.
    expect(formatChartDate("2026-03-01")).toBe("Mar 1");
  });
});
