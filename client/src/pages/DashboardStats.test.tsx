import { screen } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import type { TicketStats } from "../lib/ticket-display.ts";
import { DashboardStats } from "./DashboardStats.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const STATS: TicketStats = {
  totalTickets: 42,
  openTickets: 10,
  resolvedByAiCount: 7,
  resolvedByAiPercent: 16.7,
  averageResolutionTimeMs: 2 * 60 * 60 * 1000 + 30 * 60 * 1000, // 2h 30m
  ticketsPerDay: [],
};

beforeEach(() => {
  mockedAxios.get.mockReset();
});

describe("DashboardStats", () => {
  it("shows loading skeletons while the request is in flight", () => {
    mockedAxios.get.mockReturnValue(new Promise(() => {}));

    const { container } = renderWithQuery(<DashboardStats />);

    // 5 cards, each rendering a header skeleton and a content skeleton.
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(10);
  });

  it("renders all five stats once the request resolves", async () => {
    mockedAxios.get.mockResolvedValue({ data: STATS });

    renderWithQuery(<DashboardStats />);

    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("Total tickets")).toBeInTheDocument();

    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Open tickets")).toBeInTheDocument();

    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getAllByText("Resolved by AI")).toHaveLength(2);

    expect(screen.getByText("16.7%")).toBeInTheDocument();

    expect(screen.getByText("2h 30m")).toBeInTheDocument();
    expect(screen.getByText("Avg. resolution time")).toBeInTheDocument();
  });

  it("renders an em dash for average resolution time when nothing has been resolved yet", async () => {
    mockedAxios.get.mockResolvedValue({
      data: { ...STATS, averageResolutionTimeMs: null },
    });

    renderWithQuery(<DashboardStats />);

    expect(await screen.findByText("—")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    mockedAxios.get.mockRejectedValue(new Error("Network error"));

    renderWithQuery(<DashboardStats />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load dashboard stats — is the server running?",
    );
  });
});
