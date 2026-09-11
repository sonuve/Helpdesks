import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { TicketCategory, TicketStatus } from "core";
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
    expect(screen.getByText("OPEN")).toBeInTheDocument();
    expect(screen.getByText("Refund Request")).toBeInTheDocument();
    expect(screen.getByText("customer@example.com")).toBeInTheDocument();
    expect(
      screen.getByText("I would like a refund for my last order."),
    ).toBeInTheDocument();
  });

  it("shows 'Unclassified' for a ticket with no category", async () => {
    mockGet({ ...TICKET, category: null });

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
    mockGet();

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    expect(screen.getByRole("link", { name: /Back to tickets/ })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });

  it("shows 'Unassigned' and lists the assignable users as options", async () => {
    mockGet();

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    expect(screen.getByRole("combobox", { name: "Assigned to" })).toHaveTextContent("Unassigned");

    fireEvent.click(screen.getByRole("combobox", { name: "Assigned to" }));
    expect(await screen.findByRole("option", { name: "Agent" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Unassigned" })).toBeInTheDocument();
    expect(mockedAxios.get).toHaveBeenCalledWith("/api/users/assignable");
  });

  it("shows the current assignee's name when one is set", async () => {
    mockGet({ ...TICKET, assignedTo: ASSIGNABLE_USERS[0] });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    expect(screen.getByRole("combobox", { name: "Assigned to" })).toHaveTextContent("Agent");
  });

  it("assigns the ticket when a new assignee is picked", async () => {
    mockGet();
    mockedAxios.patch.mockResolvedValue({
      data: { ticket: { ...TICKET, assignedTo: ASSIGNABLE_USERS[0] } },
    });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    fireEvent.click(screen.getByRole("combobox", { name: "Assigned to" }));
    fireEvent.click(await screen.findByRole("option", { name: "Agent" }));

    // The mutation's request fires asynchronously (it's not mutateAsync
    // awaited inline), so the assertion needs to wait for it too — see
    // EditUserDialog.test.tsx's equivalent submit-and-check-patch tests.
    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}/assign`, {
        assignedToId: "u1",
      }),
    );
  });

  it("unassigns the ticket when 'Unassigned' is picked", async () => {
    mockGet({ ...TICKET, assignedTo: ASSIGNABLE_USERS[0] });
    mockedAxios.patch.mockResolvedValue({ data: { ticket: { ...TICKET, assignedTo: null } } });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    fireEvent.click(screen.getByRole("combobox", { name: "Assigned to" }));
    fireEvent.click(await screen.findByRole("option", { name: "Unassigned" }));

    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}/assign`, {
        assignedToId: null,
      }),
    );
  });

  it("shows the new assignee once the mutation succeeds and the ticket query refetches", async () => {
    // A mutable "server" for the GET mock to read from, so the refetch that
    // onSuccess's invalidateQueries triggers returns the post-assignment
    // ticket — proving the picker updates from the actual cache
    // invalidation, not just that PATCH was called with the right body.
    let currentTicket: typeof TICKET = TICKET;
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/tickets/")) return { data: { ticket: currentTicket } };
      if (url === "/api/users/assignable") return { data: { users: ASSIGNABLE_USERS } };
      throw new Error(`Unexpected GET ${url}`);
    });
    mockedAxios.patch.mockImplementation(async () => {
      currentTicket = { ...TICKET, assignedTo: ASSIGNABLE_USERS[0] };
      return { data: { ticket: currentTicket } };
    });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);
    expect(screen.getByRole("combobox", { name: "Assigned to" })).toHaveTextContent("Unassigned");

    fireEvent.click(screen.getByRole("combobox", { name: "Assigned to" }));
    fireEvent.click(await screen.findByRole("option", { name: "Agent" }));

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Assigned to" })).toHaveTextContent("Agent"),
    );
  });
});
