import { Badge } from "@/components/ui/badge.tsx";
import {
  replySenderTypeBadgeVariant,
  replySenderTypeLabels,
  type Ticket,
} from "@/lib/ticket-display.ts";

export function ReplyThread({ ticket }: { ticket: Ticket }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-muted-foreground">
        Replies{ticket.replies.length > 0 ? ` (${ticket.replies.length})` : ""}
      </h3>
      {ticket.replies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No replies yet.</p>
      ) : (
        ticket.replies.map((reply) => (
          <div key={reply.id} className="rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-medium">{reply.author.name}</span>
                <Badge variant={replySenderTypeBadgeVariant[reply.senderType]}>
                  {replySenderTypeLabels[reply.senderType]}
                </Badge>
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(reply.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{reply.body}</p>
          </div>
        ))
      )}
    </div>
  );
}
