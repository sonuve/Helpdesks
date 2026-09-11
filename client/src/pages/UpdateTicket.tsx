import axios from "axios";
import { TicketCategory, TicketStatus } from "core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import type { Ticket, TicketAssignee } from "@/lib/ticket-display.ts";

// Sentinel meaning "no assignee" — Radix's Select can't use "" as an
// Item value, same reasoning as TicketsTable.tsx's ALL/UNCLASSIFIED
// sentinels.
const UNASSIGNED = "UNASSIGNED";
// Same reasoning, for "no category" — mirrors TicketsTable.tsx's filter
// sentinel and the server's own (server/src/routes/tickets.ts's list
// endpoint uses this exact string as a query-param sentinel; this one is
// a distinct, purely client-side sentinel for the update Select's value).
const UNCLASSIFIED = "UNCLASSIFIED";

// Shared label+control wrapper for the Status/Category/Assigned-to Selects
// below — the three were otherwise identical apart from the label and the
// Select itself.
function SidebarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function UpdateTicket({
  ticket,
  assignableUsers,
}: {
  ticket: Ticket;
  assignableUsers?: TicketAssignee[];
}) {
  const queryClient = useQueryClient();

  const assignTicket = useMutation({
    mutationFn: async (assignedToId: string | null) => {
      const { data } = await axios.patch<{ ticket: Ticket }>(`/api/tickets/${ticket.id}/assign`, {
        assignedToId,
      });
      return data.ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticket", ticket.id] });
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
      const { data } = await axios.patch<{ ticket: Ticket }>(`/api/tickets/${ticket.id}`, update);
      return data.ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticket", ticket.id] });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <SidebarField label="Status">
        <Select
          value={ticket.status}
          onValueChange={(value) => updateTicket.mutate({ status: value as TicketStatus })}
          disabled={updateTicket.isPending}
        >
          <SelectTrigger aria-label="Status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TicketStatus.OPEN}>Open</SelectItem>
            <SelectItem value={TicketStatus.RESOLVED}>Resolved</SelectItem>
            <SelectItem value={TicketStatus.CLOSED}>Closed</SelectItem>
          </SelectContent>
        </Select>
      </SidebarField>

      <SidebarField label="Category">
        <Select
          value={ticket.category ?? UNCLASSIFIED}
          onValueChange={(value) =>
            updateTicket.mutate({
              category: value === UNCLASSIFIED ? null : (value as TicketCategory),
            })
          }
          disabled={updateTicket.isPending}
        >
          <SelectTrigger aria-label="Category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TicketCategory.GENERAL_QUESTION}>General Question</SelectItem>
            <SelectItem value={TicketCategory.TECHNICAL_QUESTION}>Technical Question</SelectItem>
            <SelectItem value={TicketCategory.REFUND_REQUEST}>Refund Request</SelectItem>
            <SelectItem value={UNCLASSIFIED}>Unclassified</SelectItem>
          </SelectContent>
        </Select>
      </SidebarField>

      <SidebarField label="Assigned to">
        <Select
          value={ticket.assignedTo?.id ?? UNASSIGNED}
          onValueChange={(value) => assignTicket.mutate(value === UNASSIGNED ? null : value)}
          disabled={assignTicket.isPending}
        >
          <SelectTrigger aria-label="Assigned to" className="w-full">
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
      </SidebarField>
    </div>
  );
}
