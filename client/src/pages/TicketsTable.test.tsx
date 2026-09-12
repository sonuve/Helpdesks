import { fireEvent, screen, within } from "@testing-library/react";
import axios from "axios";
import { TicketCategory, TicketStatus } from "core";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import { TicketsTable } from "./TicketsTable.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

// Deliberately out of newest-first order here — GET /api/tickets does the
// sorting server-side (orderBy createdAt desc), so these assert the table
// renders whatever order the API returns, not that it re-sorts client-side.
const NEWER_TICKET = {
  id: 2,
  status: TicketStatus.OPEN,
  category: null,
  subject: "Cannot log in",
  requesterEmail: "newer@example.com",
  assignedTo: null,
  createdAt: "2026-02-20T00:00:00.000Z",
};

const OLDER_TICKET = {
  id: 1,
  status: TicketStatus.RESOLVED,
  category: TicketCategory.REFUND_REQUEST,
  subject: "Refund request",
  requesterEmail: "older@example.com",
  assignedTo: { id: "u1", name: "Agent", email: "agent@example.com" },
  createdAt: "2026-01-15T00:00:00.000Z",
};

// A page's worth of tickets, plus the total count across all pages — what
// GET /api/tickets actually returns once pagination is involved. `total`
// defaults to the page's own length (as if it's the only page) unless a
// test overrides it to exercise multi-page behavior.
function ticketsResponse(tickets: unknown[], total = tickets.length) {
  return { data: { tickets, total } };
}

beforeEach(() => {
  mockedAxios.get.mockReset();
});

// Radix's Select isn't a native <select>, so filters are driven the same
// way UserForm.test.tsx's selectRole drives the role picker: click the
// trigger (by its aria-label, since these have no associated <label>),
// then click the option by its visible text.
async function selectFilter(triggerLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerLabel }));
  fireEvent.click(await screen.findByRole("option", { name: optionLabel }));
}

describe("TicketsTable", () => {
  it("shows loading skeletons while the request is in flight", () => {
    mockedAxios.get.mockReturnValue(new Promise(() => {}));

    const { container } = renderWithQuery(<TicketsTable />);

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a row per ticket, in the order the API returns them", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);

    expect(await screen.findByRole("table")).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 tickets
    expect(rows[1]).toHaveTextContent("Cannot log in");
    expect(rows[2]).toHaveTextContent("Refund request");

    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("newer@example.com")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    // No category set on this one — renders the placeholder, not "null".
    expect(rows[1]).toHaveTextContent("—");

    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("older@example.com")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Refund Request")).toBeInTheDocument();
  });

  it("shows an AI badge next to Status for a ticket resolvedByAi, and not for a normal one", async () => {
    mockedAxios.get.mockResolvedValue(
      ticketsResponse([
        { ...NEWER_TICKET, resolvedByAi: false },
        { ...OLDER_TICKET, resolvedByAi: true },
      ]),
    );

    renderWithQuery(<TicketsTable />);
    const rows = await screen.findAllByRole("row");

    expect(within(rows[1]!).queryByText("AI")).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText("AI")).toBeInTheDocument();
  });

  it("shows the assignee's name, or 'Unassigned' when there is none", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    const rows = await screen.findAllByRole("row");

    expect(rows[1]).toHaveTextContent("Unassigned");
    expect(rows[2]).toHaveTextContent("Agent");
  });

  it("links each row's subject to that ticket's detail page", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    expect(screen.getByRole("link", { name: "Cannot log in" })).toHaveAttribute(
      "href",
      "/tickets/2",
    );
    expect(screen.getByRole("link", { name: "Refund request" })).toHaveAttribute(
      "href",
      "/tickets/1",
    );
  });

  it("requests createdAt desc (newest first), page 1, the default page size, on the initial load", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    expect(mockedAxios.get).toHaveBeenCalledWith("/api/tickets", {
      params: { sortBy: "createdAt", sortOrder: "desc", page: 1, pageSize: 10 },
    });
  });

  it("re-requests with the clicked column's sortBy, ascending on the first click, and re-renders whatever the server sends back", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    // Server-driven, not a client re-sort: the mock returns the same
    // (unsorted-by-subject) order regardless of what was requested, and
    // the table just renders it — proving sorting isn't happening
    // client-side.
    mockedAxios.get.mockResolvedValue(ticketsResponse([OLDER_TICKET, NEWER_TICKET]));
    fireEvent.click(screen.getByRole("button", { name: "Subject" }));

    await screen.findByText("Refund request"); // now first, per the new mock response

    expect(mockedAxios.get).toHaveBeenCalledWith("/api/tickets", {
      params: { sortBy: "subject", sortOrder: "asc", page: 1, pageSize: 10 },
    });
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Refund request");
    expect(rows[2]).toHaveTextContent("Cannot log in");
  });

  it("toggles to descending on a second click of the same column", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Subject" })); // asc
    await screen.findByText("Cannot log in");
    fireEvent.click(screen.getByRole("button", { name: "Subject" })); // desc

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: { sortBy: "subject", sortOrder: "desc", page: 1, pageSize: 10 },
    });
  });

  it("requests a status filter when one is selected, alongside the default sort", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    await selectFilter("Filter by status", "Resolved");

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: {
        sortBy: "createdAt",
        sortOrder: "desc",
        status: "RESOLVED",
        page: 1,
        pageSize: 10,
      },
    });
  });

  it("requests a category filter when one is selected", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    await selectFilter("Filter by category", "Refund Request");

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: {
        sortBy: "createdAt",
        sortOrder: "desc",
        category: "REFUND_REQUEST",
        page: 1,
        pageSize: 10,
      },
    });
  });

  it("requests the UNCLASSIFIED sentinel for the 'Unclassified' category option", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    await selectFilter("Filter by category", "Unclassified");

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: {
        sortBy: "createdAt",
        sortOrder: "desc",
        category: "UNCLASSIFIED",
        page: 1,
        pageSize: 10,
      },
    });
  });

  it("drops the status param again after switching back to 'All statuses'", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    await selectFilter("Filter by status", "Open");
    await selectFilter("Filter by status", "All statuses");

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: { sortBy: "createdAt", sortOrder: "desc", page: 1, pageSize: 10 },
    });
  });

  it("combines a status filter with a category filter in the same request", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    await selectFilter("Filter by status", "Open");
    await selectFilter("Filter by category", "Technical Question");

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: {
        sortBy: "createdAt",
        sortOrder: "desc",
        status: "OPEN",
        category: "TECHNICAL_QUESTION",
        page: 1,
        pageSize: 10,
      },
    });
  });

  it("requests a createdFrom param when a from-date is entered", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    fireEvent.change(screen.getByLabelText("Filter by created from date"), {
      target: { value: "2026-01-01" },
    });

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: {
        sortBy: "createdAt",
        sortOrder: "desc",
        createdFrom: "2026-01-01",
        page: 1,
        pageSize: 10,
      },
    });
  });

  it("requests a createdTo param when a to-date is entered", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    fireEvent.change(screen.getByLabelText("Filter by created to date"), {
      target: { value: "2026-01-31" },
    });

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: {
        sortBy: "createdAt",
        sortOrder: "desc",
        createdTo: "2026-01-31",
        page: 1,
        pageSize: 10,
      },
    });
  });

  it("combines createdFrom and createdTo with the other filters in the same request", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    await selectFilter("Filter by status", "Open");
    fireEvent.change(screen.getByLabelText("Filter by created from date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Filter by created to date"), {
      target: { value: "2026-01-31" },
    });

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: {
        sortBy: "createdAt",
        sortOrder: "desc",
        status: "OPEN",
        createdFrom: "2026-01-01",
        createdTo: "2026-01-31",
        page: 1,
        pageSize: 10,
      },
    });
  });

  it("drops the createdFrom param again after clearing the from-date", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET]));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    const fromInput = screen.getByLabelText("Filter by created from date");
    fireEvent.change(fromInput, { target: { value: "2026-01-01" } });
    fireEvent.change(fromInput, { target: { value: "" } });

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: { sortBy: "createdAt", sortOrder: "desc", page: 1, pageSize: 10 },
    });
  });

  it("resets to page 1 when the date range changes while on a later page", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET], 30));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 3 (30 tickets)");

    fireEvent.change(screen.getByLabelText("Filter by created from date"), {
      target: { value: "2026-01-01" },
    });

    await screen.findByText(/^Page 1 of/);
    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: {
        sortBy: "createdAt",
        sortOrder: "desc",
        createdFrom: "2026-01-01",
        page: 1,
        pageSize: 10,
      },
    });
  });

  it("resets to page 1 when a filter changes while on a later page", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET], 30));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 3 (30 tickets)");

    await selectFilter("Filter by status", "Open");

    await screen.findByText(/^Page 1 of/);
    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: {
        sortBy: "createdAt",
        sortOrder: "desc",
        status: "OPEN",
        page: 1,
        pageSize: 10,
      },
    });
  });

  it("shows page/total info and disables Previous on the first page", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET], 2));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    expect(screen.getByText("Page 1 of 1 (2 tickets)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("requests page 2 with the same sort/filters when Next is clicked, and enables Previous", async () => {
    // 25 total with the default pageSize of 10 means 3 pages.
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET], 25));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 3 (25 tickets)");

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: { sortBy: "createdAt", sortOrder: "desc", page: 2, pageSize: 10 },
    });
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("disables Next once on the last page", async () => {
    // 15 total / pageSize 10 = 2 pages; landing on page 2 is the last one.
    mockedAxios.get.mockResolvedValue(ticketsResponse([NEWER_TICKET, OLDER_TICKET], 15));

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2 (15 tickets)");

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("keeps the filter controls visible and usable when a filter matches nothing", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([]));

    renderWithQuery(<TicketsTable />);
    await screen.findByText("No tickets found.");

    expect(screen.getByRole("combobox", { name: "Filter by status" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by category" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by created from date")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by created to date")).toBeInTheDocument();
  });

  it("shows an empty state when there are no tickets", async () => {
    mockedAxios.get.mockResolvedValue(ticketsResponse([]));

    renderWithQuery(<TicketsTable />);

    expect(await screen.findByText("No tickets found.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    mockedAxios.get.mockRejectedValue(new Error("Unauthorized"));

    renderWithQuery(<TicketsTable />);

    expect(
      await screen.findByText("Could not load tickets — is the server running?"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
