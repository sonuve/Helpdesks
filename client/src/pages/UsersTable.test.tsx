import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { Role } from "core";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import { UsersTable } from "./UsersTable.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const ADMIN = {
  id: "1",
  name: "Admin",
  email: "admin@example.com",
  role: Role.ADMIN,
  emailVerified: true,
  createdAt: "2026-01-15T00:00:00.000Z",
};

const AGENT = {
  id: "2",
  name: "Agent",
  email: "agent@example.com",
  role: Role.AGENT,
  emailVerified: false,
  createdAt: "2026-02-20T00:00:00.000Z",
};

beforeEach(() => {
  mockedAxios.get.mockReset();
  mockedAxios.delete.mockReset();
});

describe("UsersTable", () => {
  it("shows loading skeletons while the request is in flight", () => {
    mockedAxios.get.mockReturnValue(new Promise(() => {}));

    const { container } = renderWithQuery(<UsersTable />);

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a row per user once the request resolves", async () => {
    mockedAxios.get.mockResolvedValue({ data: { users: [ADMIN, AGENT] } });

    renderWithQuery(<UsersTable />);

    expect(await screen.findByRole("table")).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 users

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText(Role.ADMIN)).toBeInTheDocument();

    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("agent@example.com")).toBeInTheDocument();
    expect(screen.getByText(Role.AGENT)).toBeInTheDocument();

    // ADMIN is verified, AGENT is not (scope to <span> to avoid matching the "Verified" column header).
    expect(screen.getByText("Verified", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Unverified", { selector: "span" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Edit Admin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Agent" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Delete Agent" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Admins cannot be deleted" })).toBeDisabled();
  });

  it("opens a single shared edit dialog pre-filled with the clicked row's data", async () => {
    mockedAxios.get.mockResolvedValue({ data: { users: [ADMIN, AGENT] } });

    renderWithQuery(<UsersTable />);
    await screen.findByRole("table");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Admin" }));

    // Exactly one dialog instance backs every row, not one per row.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByLabelText("Name")).toHaveValue("Admin");
    expect(screen.getByLabelText("Email")).toHaveValue("admin@example.com");

    // The open dialog makes the rest of the table inert (Radix marks it
    // aria-hidden), so a real user can only reach another row's edit
    // button after dismissing it — Escape here, then the same shared
    // dialog instance serves the next row.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByLabelText("Name")).toHaveValue("Agent");
    expect(screen.getByLabelText("Email")).toHaveValue("agent@example.com");
  });

  it("opens a single shared delete confirmation for the clicked row's user, and removes the row once confirmed", async () => {
    mockedAxios.get.mockResolvedValue({ data: { users: [ADMIN, AGENT] } });
    mockedAxios.delete.mockResolvedValue({ data: { success: true } });

    renderWithQuery(<UsersTable />);
    await screen.findByRole("table");

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Agent" }));

    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Delete Agent?" })).toBeInTheDocument();

    mockedAxios.get.mockResolvedValue({ data: { users: [ADMIN] } });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockedAxios.delete).toHaveBeenCalledWith("/api/users/2"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Agent")).not.toBeInTheDocument());
  });

  it("the disabled delete button on an admin row does not open the confirmation dialog", async () => {
    mockedAxios.get.mockResolvedValue({ data: { users: [ADMIN, AGENT] } });

    renderWithQuery(<UsersTable />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Admins cannot be deleted" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it("shows an empty state when there are no users", async () => {
    mockedAxios.get.mockResolvedValue({ data: { users: [] } });

    renderWithQuery(<UsersTable />);

    expect(await screen.findByText("No users found.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    mockedAxios.get.mockRejectedValue(new Error("Forbidden"));

    renderWithQuery(<UsersTable />);

    expect(
      await screen.findByText("Could not load users — is the server running?"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
