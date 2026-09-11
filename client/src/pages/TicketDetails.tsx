import { CardTitle } from "@/components/ui/card.tsx";
import type { Ticket } from "@/lib/ticket-display.ts";

// Subject, sender, date, and message — the ticket's own fields, as opposed
// to its reply thread (TicketDetailPage.tsx) or its status/category/
// assignment controls (SidebarField).
export function TicketDetails({ ticket }: { ticket: Ticket }) {
  return (
    <>
      <CardTitle className="text-xl">
        #{ticket.id} {ticket.subject}
      </CardTitle>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          {ticket.requesterName
            ? `${ticket.requesterName} <${ticket.requesterEmail}>`
            : ticket.requesterEmail}
        </span>
        <span>Created {new Date(ticket.createdAt).toLocaleString()}</span>
      </div>
      <p className="whitespace-pre-wrap text-foreground">{ticket.body}</p>
    </>
  );
}
