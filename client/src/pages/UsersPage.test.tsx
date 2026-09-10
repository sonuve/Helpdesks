import { screen } from "@testing-library/react";
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
});
