import { TicketCategory, TicketStatus } from "core";

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
  createdAt: string;
  updatedAt: string;
};

export const categoryLabels: Record<TicketCategory, string> = {
  [TicketCategory.GENERAL_QUESTION]: "General Question",
  [TicketCategory.TECHNICAL_QUESTION]: "Technical Question",
  [TicketCategory.REFUND_REQUEST]: "Refund Request",
};

export const statusBadgeVariant: Record<TicketStatus, "default" | "secondary" | "outline"> = {
  [TicketStatus.OPEN]: "default",
  [TicketStatus.RESOLVED]: "secondary",
  [TicketStatus.CLOSED]: "outline",
};
