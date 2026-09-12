import { render, screen } from "@testing-library/react";
import { ReplySenderType, TicketCategory, TicketStatus } from "core";
import { describe, expect, it } from "vitest";
import type { Ticket } from "@/lib/ticket-display.ts";
import { ReplyThread } from "./ReplyThread.tsx";

const TICKET: Ticket = {
  id: 5,
  status: TicketStatus.OPEN,
  category: TicketCategory.REFUND_REQUEST,
  subject: "Refund request",
  body: "I would like a refund for my last order.",
  requesterEmail: "customer@example.com",
  requesterName: null,
  resolvedByAi: false,
  assignedTo: null,
  replies: [],
  createdAt: "2026-02-20T00:00:00.000Z",
  updatedAt: "2026-02-20T00:00:00.000Z",
};

describe("ReplyThread", () => {
  it("shows 'No replies yet.' and no count when the thread is empty", () => {
    render(<ReplyThread ticket={TICKET} />);

    expect(screen.getByText("No replies yet.")).toBeInTheDocument();
    expect(screen.getByText("Replies")).toBeInTheDocument();
  });

  it("renders the reply thread, oldest first as returned by the server, with a count", () => {
    render(
      <ReplyThread
        ticket={{
          ...TICKET,
          replies: [
            {
              id: 1,
              body: "First reply",
              senderType: ReplySenderType.CUSTOMER,
              author: { id: "cust1", name: "Requester Bob", email: "customer@example.com" },
              createdAt: "2026-02-20T01:00:00.000Z",
            },
            {
              id: 2,
              body: "Second reply",
              senderType: ReplySenderType.AGENT,
              author: { id: "u2", name: "Admin", email: "admin@example.com" },
              createdAt: "2026-02-20T02:00:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Replies (2)")).toBeInTheDocument();
    expect(screen.queryByText("No replies yet.")).not.toBeInTheDocument();

    const replyBodies = [screen.getByText("First reply"), screen.getByText("Second reply")];
    expect(replyBodies[0].compareDocumentPosition(replyBodies[1])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("Requester Bob")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    // Distinguishes the two senderTypes via the badge label, title-cased
    // like every other wire-value display in this codebase.
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("preserves whitespace/line breaks in a reply's body", () => {
    const { container } = render(
      <ReplyThread
        ticket={{
          ...TICKET,
          replies: [
            {
              id: 1,
              body: "Line one\nLine two",
              senderType: ReplySenderType.AGENT,
              author: { id: "u1", name: "Agent", email: "agent@example.com" },
              createdAt: "2026-02-20T01:00:00.000Z",
            },
          ],
        }}
      />,
    );

    const bodyEl = container.querySelector("p");
    expect(bodyEl).toHaveClass("whitespace-pre-wrap");
    expect(bodyEl?.textContent).toBe("Line one\nLine two");
  });
});
