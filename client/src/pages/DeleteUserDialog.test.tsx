import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import { DeleteUserDialog } from "./DeleteUserDialog.tsx";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const USER = { id: "42", name: "Jane Doe" };

beforeEach(() => {
  mockedAxios.delete.mockReset();
  mockedAxios.isAxiosError.mockReset();
});

describe("DeleteUserDialog", () => {
  it("is closed when user is null", () => {
    renderWithQuery(<DeleteUserDialog user={null} onOpenChange={vi.fn()} />);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows a confirmation naming the user when user is set", async () => {
    renderWithQuery(<DeleteUserDialog user={USER} onOpenChange={vi.fn()} />);

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delete Jane Doe?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("deletes the user and calls onOpenChange(false) when confirmed", async () => {
    mockedAxios.delete.mockResolvedValue({ data: { success: true } });
    const onOpenChange = vi.fn();

    renderWithQuery(<DeleteUserDialog user={USER} onOpenChange={onOpenChange} />);
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockedAxios.delete).toHaveBeenCalledWith("/api/users/42"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("does not close and shows an error when the server refuses the delete", async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.delete.mockRejectedValue({
      response: { data: { error: "Admin users cannot be deleted" } },
    });
    const onOpenChange = vi.fn();

    renderWithQuery(<DeleteUserDialog user={USER} onOpenChange={onOpenChange} />);
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Admin users cannot be deleted")).toBeInTheDocument();
    // The confirm button is a Dialog.Close under the hood — assert we
    // actually prevented its default auto-close on a failed delete.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("calls onOpenChange(false) without deleting when Cancel is clicked", async () => {
    const onOpenChange = vi.fn();

    renderWithQuery(<DeleteUserDialog user={USER} onOpenChange={onOpenChange} />);
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });
});
