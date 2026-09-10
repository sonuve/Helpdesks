import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { Role } from "core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import { EditUserDialog } from "./EditUserDialog.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const USER = { id: "42", name: "Jane Doe", email: "jane@example.com", role: Role.AGENT };

beforeEach(() => {
  mockedAxios.patch.mockReset();
  mockedAxios.isAxiosError.mockReset();
});

describe("EditUserDialog", () => {
  it("is closed when user is null", () => {
    renderWithQuery(<EditUserDialog user={null} onOpenChange={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the form pre-filled with the user's data when user is set", async () => {
    renderWithQuery(<EditUserDialog user={USER} onOpenChange={vi.fn()} />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edit user" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Jane Doe");
    expect(screen.getByLabelText("Email")).toHaveValue("jane@example.com");
    expect(screen.getByLabelText("Role")).toHaveTextContent("Agent");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("calls onOpenChange(false) once the form reports success", async () => {
    mockedAxios.patch.mockResolvedValue({ data: { user: { id: "42" } } });
    const onOpenChange = vi.fn();

    renderWithQuery(<EditUserDialog user={USER} onOpenChange={onOpenChange} />);
    await screen.findByRole("dialog");

    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);

    await waitFor(() =>
      expect(mockedAxios.patch).toHaveBeenCalledWith("/api/users/42", {
        name: "Jane Doe",
        email: "jane@example.com",
        role: Role.AGENT,
        password: "",
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("calls onOpenChange(false) when dismissed with Escape", async () => {
    const onOpenChange = vi.fn();

    renderWithQuery(<EditUserDialog user={USER} onOpenChange={onOpenChange} />);
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
