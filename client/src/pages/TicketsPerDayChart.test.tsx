import { screen } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import type { TicketStats } from "../lib/ticket-display.ts";
import { TicketsPerDayChart } from "./TicketsPerDayChart.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const STATS: TicketStats = {
  totalTickets: 3,
  openTickets: 3,
  resolvedByAiCount: 0,
  resolvedByAiPercent: 0,
  averageResolutionTimeMs: null,
  ticketsPerDay: [
    { date: "2026-01-08", count: 1 },
    { date: "2026-01-09", count: 0 },
    { date: "2026-01-10", count: 2 },
  ],
};

beforeEach(() => {
  mockedAxios.get.mockReset();
});

describe("TicketsPerDayChart", () => {
  it("shows the card title and a loading skeleton while the request is in flight", () => {
    mockedAxios.get.mockReturnValue(new Promise(() => {}));

    const { container } = renderWithQuery(<TicketsPerDayChart />);

    expect(screen.getByText("Tickets per day (last 30 days)")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
  });

  it("renders a chart once the request resolves", async () => {
    mockedAxios.get.mockResolvedValue({ data: STATS });

    const { container } = renderWithQuery(<TicketsPerDayChart />);

    expect(await screen.findByText("Jan 8")).toBeInTheDocument();
    expect(screen.getByText("Jan 10")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="chart"]')).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    mockedAxios.get.mockRejectedValue(new Error("Network error"));

    renderWithQuery(<TicketsPerDayChart />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the tickets-per-day chart — is the server running?",
    );
  });
});
