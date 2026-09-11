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
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Open");
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveTextContent(
      "Refund Request",
    );
    expect(screen.getByText("customer@example.com")).toBeInTheDocument();
    expect(
      screen.getByText("I would like a refund for my last order."),
    ).toBeInTheDocument();
  });

  it("shows 'Unclassified' for a ticket with no category", async () => {
    mockGet({ ...TICKET, category: null });

    renderDetailPage(TICKET.id);

    expect(await screen.findByRole("combobox", { name: "Category" })).toHaveTextContent(
      "Unclassified",
    );
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

  it("lists all three statuses as options", async () => {
    mockGet();

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    expect(await screen.findByRole("option", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Resolved" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Closed" })).toBeInTheDocument();
  });

  it("updates the status when a new one is picked", async () => {
    mockGet();
    mockedAxios.patch.mockResolvedValue({ data: { ticket: { ...TICKET, status: "RESOLVED" } } });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Resolved" }));

    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}`, {
        status: "RESOLVED",
      }),
    );
  });

  it("updates the category when a new one is picked", async () => {
    mockGet();
    mockedAxios.patch.mockResolvedValue({
      data: { ticket: { ...TICKET, category: "GENERAL_QUESTION" } },
    });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(await screen.findByRole("option", { name: "General Question" }));

    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}`, {
        category: "GENERAL_QUESTION",
      }),
    );
  });

  it("clears the category (sends null) when 'Unclassified' is picked", async () => {
    mockGet();
    mockedAxios.patch.mockResolvedValue({ data: { ticket: { ...TICKET, category: null } } });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(await screen.findByRole("option", { name: "Unclassified" }));

    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}`, {
        category: null,
      }),
    );
  });

  it("shows the new status once the mutation succeeds and the ticket query refetches", async () => {
    let currentTicket: typeof TICKET = TICKET;
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/tickets/")) return { data: { ticket: currentTicket } };
      if (url === "/api/users/assignable") return { data: { users: ASSIGNABLE_USERS } };
      throw new Error(`Unexpected GET ${url}`);
    });
    mockedAxios.patch.mockImplementation(async () => {
      currentTicket = { ...TICKET, status: "CLOSED" };
      return { data: { ticket: currentTicket } };
    });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Open");

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Closed" }));

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Closed"),
    );
  });

  it("shows 'No replies yet.' when the thread is empty", async () => {
    mockGet();

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    expect(screen.getByText("No replies yet.")).toBeInTheDocument();
  });

  it("renders the reply thread, oldest first as returned by the server", async () => {
    mockGet({
      ...TICKET,
      replies: [
        {
          id: 1,
          body: "First reply",
          senderType: "CUSTOMER",
          author: { id: "cust1", name: "Requester Bob", email: "customer@example.com" },
          createdAt: "2026-02-20T01:00:00.000Z",
        },
        {
          id: 2,
          body: "Second reply",
          senderType: "AGENT",
          author: { id: "u2", name: "Admin", email: "admin@example.com" },
          createdAt: "2026-02-20T02:00:00.000Z",
        },
      ],
    });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    expect(screen.getByText("Replies (2)")).toBeInTheDocument();
    const replyBodies = [screen.getByText("First reply"), screen.getByText("Second reply")];
    expect(replyBodies[0].compareDocumentPosition(replyBodies[1])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("Requester Bob")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    // Distinguishes the two senderTypes via the badge label, title-cased
    // like every other wire-value display in this codebase.
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("submits a new reply and clears the form on success", async () => {
    mockGet();
    mockedAxios.post.mockResolvedValue({
      data: { reply: { id: 1, body: "Thanks!", author: { id: "u1", name: "Agent" } } },
    });

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    const textarea = screen.getByRole("textbox", { name: "Reply" });
    fireEvent.change(textarea, { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() =>
      expect(mockedAxios.post).toHaveBeenCalledWith(`/api/tickets/${TICKET.id}/replies`, {
        body: "Thanks!",
      }),
    );
    await waitFor(() => expect(textarea).toHaveValue(""));
  });

  it("shows a validation error instead of submitting an empty reply", async () => {
    mockGet();

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByText("Reply cannot be empty")).toBeInTheDocument();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("shows an error message when the reply request fails", async () => {
    mockGet();
    mockedAxios.post.mockRejectedValue(new Error("Network error"));

    renderDetailPage(TICKET.id);
    await screen.findByText(/Refund request/);

    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Thanks!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByText("Could not send reply. Please try again.")).toBeInTheDocument();
  });
});
