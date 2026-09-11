import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { TicketCategory, TicketStatus } from "core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import type { Ticket, TicketAssignee } from "@/lib/ticket-display.ts";
import { UpdateTicket } from "./UpdateTicket.tsx";

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

const ASSIGNABLE_USERS: TicketAssignee[] = [
  { id: "u1", name: "Agent", email: "agent@example.com" },
  { id: "u2", name: "Admin", email: "admin@example.com" },
];

beforeEach(() => {
  mockedAxios.patch.mockReset();
});

function renderUpdateTicket(
  ticket: Ticket = TICKET,
  assignableUsers: TicketAssignee[] | undefined = ASSIGNABLE_USERS,
) {
  return renderWithQuery(<UpdateTicket ticket={ticket} assignableUsers={assignableUsers} />);
}

describe("UpdateTicket", () => {
  it("shows the ticket's current status and category", () => {
    renderUpdateTicket();

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Open");
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveTextContent(
      "Refund Request",
    );
  });

  it("shows 'Unclassified' for a ticket with no category", () => {
    renderUpdateTicket({ ...TICKET, category: null });

    expect(screen.getByRole("combobox", { name: "Category" })).toHaveTextContent("Unclassified");
  });

  it("shows 'Unassigned' and lists the assignable users as options", async () => {
    renderUpdateTicket();

    expect(screen.getByRole("combobox", { name: "Assigned to" })).toHaveTextContent("Unassigned");

    fireEvent.click(screen.getByRole("combobox", { name: "Assigned to" }));
    expect(await screen.findByRole("option", { name: "Agent" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Unassigned" })).toBeInTheDocument();
  });

  it("shows the current assignee's name when one is set", () => {
    renderUpdateTicket({ ...TICKET, assignedTo: ASSIGNABLE_USERS[0] });

    expect(screen.getByRole("combobox", { name: "Assigned to" })).toHaveTextContent("Agent");
  });

  it("assigns the ticket when a new assignee is picked", async () => {
    mockedAxios.patch.mockResolvedValue({
      data: { ticket: { ...TICKET, assignedTo: ASSIGNABLE_USERS[0] } },
    });

    renderUpdateTicket();

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
    mockedAxios.patch.mockResolvedValue({ data: { ticket: { ...TICKET, assignedTo: null } } });

    renderUpdateTicket({ ...TICKET, assignedTo: ASSIGNABLE_USERS[0] });

    fireEvent.click(screen.getByRole("combobox", { name: "Assigned to" }));
    fireEvent.click(await screen.findByRole("option", { name: "Unassigned" }));

    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}/assign`, {
        assignedToId: null,
      }),
    );
  });

  it("lists all three statuses as options", async () => {
    renderUpdateTicket();

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    expect(await screen.findByRole("option", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Resolved" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Closed" })).toBeInTheDocument();
  });

  it("updates the status when a new one is picked", async () => {
    mockedAxios.patch.mockResolvedValue({ data: { ticket: { ...TICKET, status: "RESOLVED" } } });

    renderUpdateTicket();

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Resolved" }));

    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}`, {
        status: "RESOLVED",
      }),
    );
  });

  it("updates the category when a new one is picked", async () => {
    mockedAxios.patch.mockResolvedValue({
      data: { ticket: { ...TICKET, category: "GENERAL_QUESTION" } },
    });

    renderUpdateTicket();

    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(await screen.findByRole("option", { name: "General Question" }));

    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}`, {
        category: "GENERAL_QUESTION",
      }),
    );
  });

  it("clears the category (sends null) when 'Unclassified' is picked", async () => {
    mockedAxios.patch.mockResolvedValue({ data: { ticket: { ...TICKET, category: null } } });

    renderUpdateTicket();

    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(await screen.findByRole("option", { name: "Unclassified" }));

    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}`, {
        category: null,
      }),
    );
  });

  it("disables the Status and Category selects while an update is in flight", async () => {
    mockedAxios.patch.mockReturnValue(new Promise(() => {}));

    renderUpdateTicket();

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Resolved" }));

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Status" })).toBeDisabled());
    expect(screen.getByRole("combobox", { name: "Category" })).toBeDisabled();
  });

  it("posts to the ticket id taken from the ticket prop, not a hardcoded one", async () => {
    mockedAxios.patch.mockResolvedValue({ data: { ticket: { ...TICKET, id: 42 } } });

    renderUpdateTicket({ ...TICKET, id: 42 });

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Closed" }));

    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith("/api/tickets/42", { status: "CLOSED" }),
    );
  });
});
