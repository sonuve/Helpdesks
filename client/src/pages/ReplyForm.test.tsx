import { fireEvent, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { TicketCategory, TicketStatus } from "core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/render-with-query.tsx";
import type { Ticket } from "@/lib/ticket-display.ts";
import { ReplyForm } from "./ReplyForm.tsx";

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

beforeEach(() => {
  mockedAxios.post.mockReset();
});

function renderReplyForm(ticket: Ticket = TICKET) {
  return renderWithQuery(<ReplyForm ticket={ticket} />);
}

describe("ReplyForm", () => {
  it("renders a reply textarea and submit button", () => {
    renderReplyForm();

    expect(screen.getByRole("textbox", { name: "Reply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reply" })).toBeInTheDocument();
  });

  it("shows a validation error instead of submitting an empty reply", async () => {
    renderReplyForm();

    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByText("Reply cannot be empty")).toBeInTheDocument();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("submits a new reply for the given ticket and clears the form on success", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { reply: { id: 1, body: "Thanks!", author: { id: "u1", name: "Agent" } } },
    });

    renderReplyForm();

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

  it("posts to the ticket id taken from the ticket prop", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { reply: { id: 1, body: "Thanks!", author: { id: "u1", name: "Agent" } } },
    });

    renderReplyForm({ ...TICKET, id: 42 });

    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Thanks!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() =>
      expect(mockedAxios.post).toHaveBeenCalledWith("/api/tickets/42/replies", {
        body: "Thanks!",
      }),
    );
  });

  it("disables the submit button and shows a sending label while the request is in flight", async () => {
    mockedAxios.post.mockReturnValue(new Promise(() => {}));

    renderReplyForm();

    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Thanks!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    const submitButton = await screen.findByRole("button", { name: "Sending..." });
    expect(submitButton).toBeDisabled();
  });

  it("shows an error message when the reply request fails", async () => {
    mockedAxios.post.mockRejectedValue(new Error("Network error"));

    renderReplyForm();

    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Thanks!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByText("Could not send reply. Please try again.")).toBeInTheDocument();
  });

  it("clears a previous error and the textarea once a retried submission succeeds", async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error("Network error"));

    renderReplyForm();

    const textarea = screen.getByRole("textbox", { name: "Reply" });
    fireEvent.change(textarea, { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByText("Could not send reply. Please try again.")).toBeInTheDocument();

    mockedAxios.post.mockResolvedValueOnce({
      data: { reply: { id: 1, body: "Thanks!", author: { id: "u1", name: "Agent" } } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() =>
      expect(
        screen.queryByText("Could not send reply. Please try again."),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(textarea).toHaveValue(""));
  });
});
