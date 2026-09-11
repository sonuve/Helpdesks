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
