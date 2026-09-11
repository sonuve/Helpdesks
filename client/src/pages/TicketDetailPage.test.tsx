import { fireEvent, screen } from "@testing-library/react";
import axios from "axios";
import { ReplySenderType, TicketCategory, TicketStatus } from "core";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import type { Ticket } from "@/lib/ticket-display.ts";
import { TicketDetailPage } from "./TicketDetailPage.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const TICKET: Ticket = {
  id: 5,
  status: TicketStatus.OPEN,
  category: TicketCategory.REFUND_REQUEST,
  subject: "Refund request",
  body: "I would like a refund for my last order.",
  requesterEmail: "customer@example.com",
  assignedTo: null,
  replies: [],
  createdAt: "2026-02-20T00:00:00.000Z",
  updatedAt: "2026-02-20T00:00:00.000Z",
};

const ASSIGNABLE_USERS = [
  { id: "u1", name: "Agent", email: "agent@example.com" },
  { id: "u2", name: "Admin", email: "admin@example.com" },
];

beforeEach(() => {
  mockedAxios.get.mockReset();
  mockedAxios.patch.mockReset();
  mockedAxios.post.mockReset();
});

// GET /api/tickets/:id and GET /api/users/assignable both fire on render —
// dispatch each mocked response by URL rather than a single blanket
// mockResolvedValue, which can't tell the two apart.
function mockGet(ticket: unknown = TICKET, users: unknown = ASSIGNABLE_USERS) {
  mockedAxios.get.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/tickets/")) return { data: { ticket } };
    if (url === "/api/users/assignable") return { data: { users } };
    throw new Error(`Unexpected GET ${url}`);
  });
}

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
    mockGet();

    renderDetailPage(TICKET.id);

    await screen.findByText(/Refund request/);
    expect(mockedAxios.get).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}`);
  });

  it("renders the ticket's details, including its body", async () => {
    mockGet();

    renderDetailPage(TICKET.id);

    expect(await screen.findByText(/Refund request/)).toBeInTheDocument();
    expect(screen.getByText("customer@example.com")).toBeInTheDocument();
    expect(
      screen.getByText("I would like a refund for my last order."),
    ).toBeInTheDocument();
  });

  it("renders the update panel for the current ticket and assignable users", async () => {
    mockGet();

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Open");
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveTextContent(
      "Refund Request",
    );
    expect(screen.getByRole("combobox", { name: "Assigned to" })).toHaveTextContent("Unassigned");

    fireEvent.click(screen.getByRole("combobox", { name: "Assigned to" }));
    expect(await screen.findByRole("option", { name: "Agent" })).toBeInTheDocument();
    expect(mockedAxios.get).toHaveBeenCalledWith("/api/users/assignable");
  });

  it("shows an error message when the request fails", async () => {
    mockedAxios.get.mockRejectedValue(new Error("Not found"));

    renderDetailPage(TICKET.id);

    expect(
      await screen.findByText("Could not load this ticket — is the server running?"),
    ).toBeInTheDocument();
  });

  it("has a link back to the tickets list", async () => {
    mockGet();

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    expect(screen.getByRole("link", { name: /Back to tickets/ })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });

  it("renders the reply thread and reply form for the current ticket", async () => {
    mockGet();

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    expect(screen.getByText("No replies yet.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Reply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reply" })).toBeInTheDocument();
  });

  it("shows the new reply once ReplyForm's mutation succeeds and the ticket query refetches", async () => {
    // Guards against a query-key mismatch regression: ReplyForm only has the
    // loaded `Ticket` object to invalidate with (`ticket.id`, a number),
    // while this page's own query key is built from the :id route param
    // (always a string). If the two ever drift back out of sync,
    // invalidateQueries's strict key matching silently no-ops and this
    // never appears without a manual refetch.
    let currentTicket: typeof TICKET = TICKET;
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/tickets/")) return { data: { ticket: currentTicket } };
      if (url === "/api/users/assignable") return { data: { users: ASSIGNABLE_USERS } };
      throw new Error(`Unexpected GET ${url}`);
    });
    mockedAxios.post.mockImplementation(async () => {
      const reply = {
        id: 1,
        body: "Thanks!",
        senderType: ReplySenderType.AGENT,
        author: { id: "u1", name: "Agent", email: "agent@example.com" },
        createdAt: "2026-02-20T03:00:00.000Z",
      };
      currentTicket = { ...TICKET, replies: [...currentTicket.replies, reply] };
      return { data: { reply } };
    });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);
    expect(screen.getByText("No replies yet.")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Thanks!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByText("Thanks!")).toBeInTheDocument();
    expect(screen.queryByText("No replies yet.")).not.toBeInTheDocument();
  });
});
