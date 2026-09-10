import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import { CreateUserDialog } from "./CreateUserDialog.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

beforeEach(() => {
  mockedAxios.post.mockReset();
  mockedAxios.isAxiosError.mockReset();
});

describe("CreateUserDialog", () => {
  it("is closed until the trigger is clicked, then shows the create-user form", async () => {
    renderWithQuery(<CreateUserDialog />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New user" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create user" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("closes the dialog once the form reports success", async () => {
    mockedAxios.post.mockResolvedValue({ data: { user: { id: "1" } } });

    renderWithQuery(<CreateUserDialog />);
    fireEvent.click(screen.getByRole("button", { name: "New user" }));

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByLabelText("Role"));
    fireEvent.click(await screen.findByRole("option", { name: "Agent" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
