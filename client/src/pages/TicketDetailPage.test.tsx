import { screen } from "@testing-library/react";
import axios from "axios";
import { TicketCategory, TicketStatus } from "core";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import { TicketDetailPage } from "./TicketDetailPage.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const TICKET = {
  id: 5,
  status: TicketStatus.OPEN,
  category: TicketCategory.REFUND_REQUEST,
  subject: "Refund request",
  body: "I would like a refund for my last order.",
  requesterEmail: "customer@example.com",
  createdAt: "2026-02-20T00:00:00.000Z",
  updatedAt: "2026-02-20T00:00:00.000Z",
};

beforeEach(() => {
  mockedAxios.get.mockReset();
});

function renderDetailPage(id: string | number) {
  return renderWithQuery(
    <Routes>
      <Route path="/tickets/:id" element={<TicketDetailPage />} />
    </Routes>,
    { initialEntries: [`/tickets/${id}`] },
  );
}

describe("TicketDetailPage", () => {
  it("shows loading skeletons while the request is in flight", () => {
    mockedAxios.get.mockReturnValue(new Promise(() => {}));

    renderDetailPage(TICKET.id);

    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
  });

  it("requests the ticket by the :id route param", async () => {
    mockedAxios.get.mockResolvedValue({ data: { ticket: TICKET } });

    renderDetailPage(TICKET.id);

    await screen.findByText(/Refund request/);
    expect(mockedAxios.get).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}`);
  });

  it("renders the ticket's details, including its body", async () => {
    mockedAxios.get.mockResolvedValue({ data: { ticket: TICKET } });

    renderDetailPage(TICKET.id);

    expect(await screen.findByText(/Refund request/)).toBeInTheDocument();
    expect(screen.getByText("OPEN")).toBeInTheDocument();
    expect(screen.getByText("Refund Request")).toBeInTheDocument();
    expect(screen.getByText("customer@example.com")).toBeInTheDocument();
    expect(
      screen.getByText("I would like a refund for my last order."),
    ).toBeInTheDocument();
  });

  it("shows 'Unclassified' for a ticket with no category", async () => {
    mockedAxios.get.mockResolvedValue({ data: { ticket: { ...TICKET, category: null } } });

    renderDetailPage(TICKET.id);

    expect(await screen.findByText("Unclassified")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    mockedAxios.get.mockRejectedValue(new Error("Not found"));

    renderDetailPage(TICKET.id);

    expect(
      await screen.findByText("Could not load this ticket — is the server running?"),
    ).toBeInTheDocument();
  });

  it("has a link back to the tickets list", async () => {
    mockedAxios.get.mockResolvedValue({ data: { ticket: TICKET } });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    expect(screen.getByRole("link", { name: /Back to tickets/ })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });
});
