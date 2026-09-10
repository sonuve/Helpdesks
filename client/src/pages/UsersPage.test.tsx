import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import { UsersPage } from "./UsersPage.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

beforeEach(() => {
  mockedAxios.get.mockReset();
});

describe("UsersPage", () => {
  it("renders the heading, the create-user trigger, and the users table", async () => {
    mockedAxios.get.mockResolvedValue({ data: { users: [] } });

    renderWithQuery(<UsersPage />);

    expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New user" })).toBeInTheDocument();
    expect(await screen.findByText("No users found.")).toBeInTheDocument();
  });

  it("shows the create-user dialog when the New user button is clicked", async () => {
    mockedAxios.get.mockResolvedValue({ data: { users: [] } });

    renderWithQuery(<UsersPage />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New user" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("hides the dialog when Escape is pressed", async () => {
    mockedAxios.get.mockResolvedValue({ data: { users: [] } });

    renderWithQuery(<UsersPage />);
    fireEvent.click(screen.getByRole("button", { name: "New user" }));
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("hides the dialog when clicking outside of it", async () => {
    mockedAxios.get.mockResolvedValue({ data: { users: [] } });

    renderWithQuery(<UsersPage />);
    fireEvent.click(screen.getByRole("button", { name: "New user" }));
    await screen.findByRole("dialog");

    // Radix's Dialog dismisses on outside interaction using the same
    // pointerdown-then-click sequence a real click produces — a plain
    // fireEvent.click alone doesn't include the pointerdown half.
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    fireEvent.pointerDown(overlay!, { button: 0 });
    fireEvent.click(overlay!);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
