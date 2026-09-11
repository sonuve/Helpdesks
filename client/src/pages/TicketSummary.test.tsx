import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { TicketCategory, TicketStatus } from "core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import type { Ticket } from "@/lib/ticket-display.ts";
import { TicketSummary } from "./TicketSummary.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const TICKET: Ticket = {
  id: 5,
  status: TicketStatus.OPEN,
  category: TicketCategory.REFUND_REQUEST,
  subject: "Refund request",
  body: "I would like a refund for my last order.",
  requesterEmail: "customer@example.com",
  requesterName: null,
  assignedTo: null,
  replies: [],
  createdAt: "2026-02-20T00:00:00.000Z",
  updatedAt: "2026-02-20T00:00:00.000Z",
};

beforeEach(() => {
  mockedAxios.post.mockReset();
});

function renderTicketSummary(ticket: Ticket = TICKET) {
  return renderWithQuery(<TicketSummary ticket={ticket} />);
}

describe("TicketSummary", () => {
  it("renders a Summarize button and no summary text initially", () => {
    renderTicketSummary();

    expect(screen.getByRole("button", { name: "Summarize" })).toBeInTheDocument();
    expect(screen.queryByText(/Mocked summary/)).not.toBeInTheDocument();
  });

  it("requests and displays a summary on click", async () => {
    mockedAxios.post.mockResolvedValue({ data: { summary: "A concise summary." } });

    renderTicketSummary();

    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));

    await waitFor(() =>
      expect(mockedAxios.post).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}/summarize`),
    );
    expect(await screen.findByText("A concise summary.")).toBeInTheDocument();
  });

  it("posts to the ticket id taken from the ticket prop", async () => {
    mockedAxios.post.mockResolvedValue({ data: { summary: "Summary." } });

    renderTicketSummary({ ...TICKET, id: 42 });

    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));

    await waitFor(() =>
      expect(mockedAxios.post).toHaveBeenCalledWith("/api/tickets/42/summarize"),
    );
  });

  it("relabels the button 'Regenerate summary' and re-fetches on a second click", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { summary: "First summary." } })
      .mockResolvedValueOnce({ data: { summary: "Second summary." } });

    renderTicketSummary();

    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
    expect(await screen.findByText("First summary.")).toBeInTheDocument();

    const regenerateButton = screen.getByRole("button", { name: "Regenerate summary" });
    fireEvent.click(regenerateButton);

    expect(await screen.findByText("Second summary.")).toBeInTheDocument();
    expect(screen.queryByText("First summary.")).not.toBeInTheDocument();
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it("disables the button and shows a summarizing label while the request is in flight", async () => {
    mockedAxios.post.mockReturnValue(new Promise(() => {}));

    renderTicketSummary();

    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));

    const button = await screen.findByRole("button", { name: "Summarizing..." });
    expect(button).toBeDisabled();
  });

  it("shows an error message when summarizing fails", async () => {
    mockedAxios.post.mockRejectedValue(new Error("Network error"));

    renderTicketSummary();

    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));

    expect(
      await screen.findByText("Could not summarize this ticket. Please try again."),
    ).toBeInTheDocument();
  });
});
