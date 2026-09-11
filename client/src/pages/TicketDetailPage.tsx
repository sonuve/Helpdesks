import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { ErrorMessage } from "@/components/ErrorMessage.tsx";
import { type Ticket, type TicketAssignee } from "@/lib/ticket-display.ts";
import { ReplyForm } from "./ReplyForm.tsx";
import { ReplyThread } from "./ReplyThread.tsx";
import { TicketDetails } from "./TicketDetails.tsx";
import { TicketDetailsSkeleton } from "./TicketDetailsSkeleton.tsx";
import { TicketSummary } from "./TicketSummary.tsx";
import { UpdateTicket } from "./UpdateTicket.tsx";

export function TicketDetailPage() {
  const { id } = useParams();
  // Route params are always strings; Ticket.id (and ReplyForm's/
  // UpdateTicket's own invalidateQueries calls, since they only have the
  // loaded `Ticket` object to work from) is a number — coercing once here
  // keeps every ["ticket", ...] query key in this numeric form, so
  // invalidation (which matches key elements by strict equality, not just
  // string coercion) actually finds this query.
  const ticketId = Number(id);

  const { data, isPending, isError } = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: async () => {
      const { data } = await axios.get<{ ticket: Ticket }>(`/api/tickets/${ticketId}`);
      return data.ticket;
    },
  });

  // Any authenticated user can be assigned a ticket, not just admins — see
  // GET /api/users/assignable (server/src/routes/users.ts), a deliberately
  // minimal endpoint separate from the admin-only GET /api/users.
  const { data: assignableUsers } = useQuery({
    queryKey: ["users", "assignable"],
    queryFn: async () => {
      const { data } = await axios.get<{ users: TicketAssignee[] }>("/api/users/assignable");
      return data.users;
    },
  });

  return (
    <section className="flex flex-grow flex-col gap-6 p-8">
      <Button asChild variant="ghost" size="sm" className="-ml-3 w-fit">
        <Link to="/tickets">
          <ArrowLeftIcon className="size-4" />
          Back to tickets
        </Link>
      </Button>

      {isPending ? (
        <TicketDetailsSkeleton />
      ) : isError ? (
        <ErrorMessage message="Could not load this ticket — is the server running?" />
      ) : (
        <Card>
          <CardContent className="grid gap-6 md:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-4">
              <TicketDetails ticket={data} />

              <TicketSummary ticket={data} />

              <Separator />

              <ReplyThread ticket={data} />

              <ReplyForm ticket={data} />
            </div>

            <UpdateTicket ticket={data} assignableUsers={assignableUsers} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}
