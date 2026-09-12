import { ReplySenderType, TicketCategory, TicketStatus } from "core";

export type TicketAssignee = { id: string; name: string; email: string };

export type TicketReplyAuthor = { id: string; name: string; email: string };

export type TicketReply = {
  id: number;
  body: string;
  senderType: ReplySenderType;
  author: TicketReplyAuthor;
  createdAt: string;
};

// Shared between TicketsTable.tsx (list) and TicketDetailPage.tsx (single
// ticket) so the two views can't drift apart on how a status/category
// renders.
export type Ticket = {
  id: number;
  status: TicketStatus;
  category: TicketCategory | null;
  subject: string;
  body: string;
  requesterEmail: string;
  requesterName: string | null;
  assignedTo: TicketAssignee | null;
  // True when an AI auto-resolve job (server/src/lib/queue.ts) resolved
  // this ticket on its own, no agent involved. GET /api/tickets excludes
  // these from its default response, so they don't show up in
  // TicketsTable at all unless the Status filter is explicitly set to
  // Resolved — this field only matters for the badge shown once one is
  // actually visible (TicketsTable's Status column, TicketDetails.tsx).
  resolvedByAi: boolean;
  // Only populated on the single-ticket detail response
  // (GET /api/tickets/:id) — same reasoning as `body`, a paginated list
  // response shouldn't carry a field only the detail view needs.
  replies: TicketReply[];
  createdAt: string;
  updatedAt: string;
};

export const categoryLabels: Record<TicketCategory, string> = {
  [TicketCategory.GENERAL_QUESTION]: "General Question",
  [TicketCategory.TECHNICAL_QUESTION]: "Technical Question",
  [TicketCategory.REFUND_REQUEST]: "Refund Request",
};

// Title-cased for display — TicketStatus's own values (OPEN/RESOLVED/
// CLOSED) are the wire format, not what should render in the UI, same
// reasoning as categoryLabels above.
export const statusLabels: Record<TicketStatus, string> = {
  [TicketStatus.OPEN]: "Open",
  [TicketStatus.RESOLVED]: "Resolved",
  [TicketStatus.CLOSED]: "Closed",
};

export const statusBadgeVariant: Record<TicketStatus, "default" | "secondary" | "outline"> = {
  [TicketStatus.OPEN]: "default",
  [TicketStatus.RESOLVED]: "secondary",
  [TicketStatus.CLOSED]: "outline",
};

// Title-cased for display, same reasoning as statusLabels/categoryLabels
// above — ReplySenderType's own values (AGENT/CUSTOMER) are the wire
// format, not what should render in the reply thread.
export const replySenderTypeLabels: Record<ReplySenderType, string> = {
  [ReplySenderType.AGENT]: "Agent",
  [ReplySenderType.CUSTOMER]: "Customer",
};

export const replySenderTypeBadgeVariant: Record<ReplySenderType, "default" | "secondary"> = {
  [ReplySenderType.AGENT]: "secondary",
  [ReplySenderType.CUSTOMER]: "default",
};

// GET /api/tickets/stats's response shape — the dashboard's aggregate
// counters. averageResolutionTimeMs is null (not 0/NaN) when no ticket has
// been resolved yet, matching server/src/lib/ticket-stats.ts's
// computeAverageResolutionTimeMs — "no data" and "resolved instantly" are
// different things the dashboard should render differently.
export type TicketsPerDay = { date: string; count: number };

export type TicketStats = {
  totalTickets: number;
  openTickets: number;
  resolvedByAiCount: number;
  resolvedByAiPercent: number;
  averageResolutionTimeMs: number | null;
  // Fixed-width, 30 entries, oldest first, zero-filled for days with no
  // tickets — see the get_ticket_stats() Postgres function (added by the
  // add_ticket_stats_function migration) that computes this. `date` is a
  // plain "YYYY-MM-DD" (UTC calendar day), not an ISO timestamp.
  ticketsPerDay: TicketsPerDay[];
};

// Renders a millisecond duration as a compact, human-readable string (e.g.
// "2d 4h", "3h 15m", "45m") for the dashboard's "average resolution time"
// stat — raw milliseconds (or even raw hours) wouldn't read naturally.
// Picks the two largest non-zero units rather than every unit down to the
// second, since a support-ticket resolution time in the tens of minutes to
// several days doesn't need second-level precision.
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remainingMinutes === 0 ? `${totalHours}h` : `${totalHours}h ${remainingMinutes}m`;
  }
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`;
}

// Renders a TicketsPerDay entry's plain "YYYY-MM-DD" as a short label (e.g.
// "Jan 9") for the tickets-per-day chart's x-axis. Parses/formats in UTC
// explicitly — the date string is a UTC calendar day (see TicketStats'
// comment), so doing this in the viewer's local timezone could shift it to
// the wrong day near midnight.
export function formatChartDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
