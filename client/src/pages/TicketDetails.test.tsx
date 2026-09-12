import { render, screen } from "@testing-library/react";
import { ReplySenderType, TicketCategory, TicketStatus } from "core";
import { describe, expect, it } from "vitest";
import type { Ticket } from "@/lib/ticket-display.ts";
import { TicketDetails } from "./TicketDetails.tsx";

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

describe("TicketDetails", () => {
  it("renders the subject and id, the requester's email, creation date, and body", () => {
    render(<TicketDetails ticket={TICKET} />);

    expect(screen.getByText(`#${TICKET.id} ${TICKET.subject}`)).toBeInTheDocument();
    expect(screen.getByText("customer@example.com")).toBeInTheDocument();
    expect(
      screen.getByText(`Created ${new Date(TICKET.createdAt).toLocaleString()}`),
    ).toBeInTheDocument();
    expect(screen.getByText("I would like a refund for my last order.")).toBeInTheDocument();
  });

  it("shows the requester's name alongside their email when one is on file", () => {
    render(<TicketDetails ticket={{ ...TICKET, requesterName: "Isabella Moreau" }} />);

    expect(screen.getByText("Isabella Moreau <customer@example.com>")).toBeInTheDocument();
  });

  it("falls back to just the email when there's no requester name", () => {
    render(<TicketDetails ticket={TICKET} />);

    expect(screen.getByText("customer@example.com")).toBeInTheDocument();
  });

  it("does not render anything about replies", () => {
    render(
      <TicketDetails
        ticket={{
          ...TICKET,
          replies: [
            {
              id: 1,
              body: "A reply",
              senderType: ReplySenderType.AGENT,
              author: { id: "u1", name: "Agent", email: "agent@example.com" },
              createdAt: "2026-02-20T01:00:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText("A reply")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });

  it("preserves whitespace/line breaks in the body", () => {
    const { container } = render(
      <TicketDetails ticket={{ ...TICKET, body: "Line one\nLine two" }} />,
    );

    const bodyEl = container.querySelector("p");
    expect(bodyEl).toHaveClass("whitespace-pre-wrap");
    expect(bodyEl?.textContent).toBe("Line one\nLine two");
  });
});
