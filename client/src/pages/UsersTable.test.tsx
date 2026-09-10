import { screen } from "@testing-library/react";
import axios from "axios";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import { UsersTable } from "./UsersTable.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const ADMIN = {
  id: "1",
  name: "Admin",
  email: "admin@example.com",
  role: "ADMIN" as const,
  emailVerified: true,
  createdAt: "2026-01-15T00:00:00.000Z",
};

const AGENT = {
  id: "2",
  name: "Agent",
  email: "agent@example.com",
  role: "AGENT" as const,
  emailVerified: false,
  createdAt: "2026-02-20T00:00:00.000Z",
};

beforeEach(() => {
  mockedAxios.get.mockReset();
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
    expect(screen.getByText("ADMIN")).toBeInTheDocument();

    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("agent@example.com")).toBeInTheDocument();
    expect(screen.getByText("AGENT")).toBeInTheDocument();

    // ADMIN is verified, AGENT is not (scope to <span> to avoid matching the "Verified" column header).
    expect(screen.getByText("Verified", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Unverified", { selector: "span" })).toBeInTheDocument();
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
