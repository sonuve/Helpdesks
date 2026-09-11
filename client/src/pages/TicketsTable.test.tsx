import { fireEvent, screen } from "@testing-library/react";
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
  createdAt: "2026-02-20T00:00:00.000Z",
};

const OLDER_TICKET = {
  id: 1,
  status: TicketStatus.RESOLVED,
  category: TicketCategory.REFUND_REQUEST,
  subject: "Refund request",
  requesterEmail: "older@example.com",
  createdAt: "2026-01-15T00:00:00.000Z",
};

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
    mockedAxios.get.mockResolvedValue({ data: { tickets: [NEWER_TICKET, OLDER_TICKET] } });

    renderWithQuery(<TicketsTable />);

    expect(await screen.findByRole("table")).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 tickets
    expect(rows[1]).toHaveTextContent("Cannot log in");
    expect(rows[2]).toHaveTextContent("Refund request");

    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("newer@example.com")).toBeInTheDocument();
    expect(screen.getByText("OPEN")).toBeInTheDocument();
    // No category set on this one — renders the placeholder, not "null".
    expect(rows[1]).toHaveTextContent("—");

    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("older@example.com")).toBeInTheDocument();
    expect(screen.getByText("RESOLVED")).toBeInTheDocument();
    expect(screen.getByText("Refund Request")).toBeInTheDocument();
  });

  it("requests createdAt desc (newest first) on the initial load", async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [NEWER_TICKET, OLDER_TICKET] } });

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    expect(mockedAxios.get).toHaveBeenCalledWith("/api/tickets", {
      params: { sortBy: "createdAt", sortOrder: "desc" },
    });
  });

  it("re-requests with the clicked column's sortBy, ascending on the first click, and re-renders whatever the server sends back", async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [NEWER_TICKET, OLDER_TICKET] } });

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    // Server-driven, not a client re-sort: the mock returns the same
    // (unsorted-by-subject) order regardless of what was requested, and
    // the table just renders it — proving sorting isn't happening
    // client-side.
    mockedAxios.get.mockResolvedValue({ data: { tickets: [OLDER_TICKET, NEWER_TICKET] } });
    fireEvent.click(screen.getByRole("button", { name: "Subject" }));

    await screen.findByText("Refund request"); // now first, per the new mock response

    expect(mockedAxios.get).toHaveBeenCalledWith("/api/tickets", {
      params: { sortBy: "subject", sortOrder: "asc" },
    });
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Refund request");
    expect(rows[2]).toHaveTextContent("Cannot log in");
  });

  it("toggles to descending on a second click of the same column", async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [NEWER_TICKET, OLDER_TICKET] } });

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Subject" })); // asc
    await screen.findByText("Cannot log in");
    fireEvent.click(screen.getByRole("button", { name: "Subject" })); // desc

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: { sortBy: "subject", sortOrder: "desc" },
    });
  });

  it("requests a status filter when one is selected, alongside the default sort", async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [NEWER_TICKET, OLDER_TICKET] } });

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    await selectFilter("Filter by status", "Resolved");

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: { sortBy: "createdAt", sortOrder: "desc", status: "RESOLVED" },
    });
  });

  it("requests a category filter when one is selected", async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [NEWER_TICKET, OLDER_TICKET] } });

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    await selectFilter("Filter by category", "Refund Request");

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: { sortBy: "createdAt", sortOrder: "desc", category: "REFUND_REQUEST" },
    });
  });

  it("requests the UNCLASSIFIED sentinel for the 'Unclassified' category option", async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [NEWER_TICKET, OLDER_TICKET] } });

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    await selectFilter("Filter by category", "Unclassified");

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: { sortBy: "createdAt", sortOrder: "desc", category: "UNCLASSIFIED" },
    });
  });

  it("drops the status param again after switching back to 'All statuses'", async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [NEWER_TICKET, OLDER_TICKET] } });

    renderWithQuery(<TicketsTable />);
    await screen.findByRole("table");

    await selectFilter("Filter by status", "Open");
    await selectFilter("Filter by status", "All statuses");

    expect(mockedAxios.get).toHaveBeenLastCalledWith("/api/tickets", {
      params: { sortBy: "createdAt", sortOrder: "desc" },
    });
  });

  it("combines a status filter with a category filter in the same request", async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [NEWER_TICKET, OLDER_TICKET] } });

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
      },
    });
  });

  it("keeps the filter controls visible and usable when a filter matches nothing", async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [] } });

    renderWithQuery(<TicketsTable />);
    await screen.findByText("No tickets found.");

    expect(screen.getByRole("combobox", { name: "Filter by status" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by category" })).toBeInTheDocument();
  });

  it("shows an empty state when there are no tickets", async () => {
    mockedAxios.get.mockResolvedValue({ data: { tickets: [] } });

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
