import axios from "axios";
import { TicketCategory, TicketStatus } from "core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { type Ticket, type TicketAssignee } from "@/lib/ticket-display.ts";

// Sentinel meaning "no assignee" — Radix's Select can't use "" as an
// Item value, same reasoning as TicketsTable.tsx's ALL/UNCLASSIFIED
// sentinels.
const UNASSIGNED = "UNASSIGNED";
// Same reasoning, for "no category" — mirrors TicketsTable.tsx's filter
// sentinel and the server's own (server/src/routes/tickets.ts's list
// endpoint uses this exact string as a query-param sentinel; this one is
// a distinct, purely client-side sentinel for the update Select's value).
const UNCLASSIFIED = "UNCLASSIFIED";

export function TicketDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const { data, isPending, isError } = useQuery({
    queryKey: ["ticket", id],
    queryFn: async () => {
      const { data } = await axios.get<{ ticket: Ticket }>(`/api/tickets/${id}`);
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

  const assignTicket = useMutation({
    mutationFn: async (assignedToId: string | null) => {
      const { data } = await axios.patch<{ ticket: Ticket }>(`/api/tickets/${id}/assign`, {
        assignedToId,
      });
      return data.ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticket", id] });
      // Prefix match: also refetches the tickets list so its Assignee
      // column stays in sync if the user navigates back.
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  // Shared by both the status and category Selects below — each fires this
  // with only its own field set, matching PATCH /api/tickets/:id's partial
  // update (server/src/routes/tickets.ts): the other field is left
  // untouched server-side when omitted from the request body.
  const updateTicket = useMutation({
    mutationFn: async (update: { status?: TicketStatus; category?: TicketCategory | null }) => {
      const { data } = await axios.patch<{ ticket: Ticket }>(`/api/tickets/${id}`, update);
      return data.ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticket", id] });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
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
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-96" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : isError ? (
        <p className="text-destructive">Could not load this ticket — is the server running?</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              #{data.id} {data.subject}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{data.requesterEmail}</span>
              <span>Created {new Date(data.createdAt).toLocaleString()}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Status</span>
                <Select
                  value={data.status}
                  onValueChange={(value) =>
                    updateTicket.mutate({ status: value as TicketStatus })
                  }
                  disabled={updateTicket.isPending}
                >
                  <SelectTrigger aria-label="Status" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TicketStatus.OPEN}>Open</SelectItem>
                    <SelectItem value={TicketStatus.RESOLVED}>Resolved</SelectItem>
                    <SelectItem value={TicketStatus.CLOSED}>Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Category</span>
                <Select
                  value={data.category ?? UNCLASSIFIED}
                  onValueChange={(value) =>
                    updateTicket.mutate({
                      category: value === UNCLASSIFIED ? null : (value as TicketCategory),
                    })
                  }
                  disabled={updateTicket.isPending}
                >
                  <SelectTrigger aria-label="Category" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TicketCategory.GENERAL_QUESTION}>
                      General Question
                    </SelectItem>
                    <SelectItem value={TicketCategory.TECHNICAL_QUESTION}>
                      Technical Question
                    </SelectItem>
                    <SelectItem value={TicketCategory.REFUND_REQUEST}>Refund Request</SelectItem>
                    <SelectItem value={UNCLASSIFIED}>Unclassified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Assigned to</span>
              <Select
                value={data.assignedTo?.id ?? UNASSIGNED}
                onValueChange={(value) =>
                  assignTicket.mutate(value === UNASSIGNED ? null : value)
                }
                disabled={assignTicket.isPending}
              >
                <SelectTrigger aria-label="Assigned to" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {assignableUsers?.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="whitespace-pre-wrap text-foreground">{data.body}</p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
