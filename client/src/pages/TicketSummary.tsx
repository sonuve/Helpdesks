import axios from "axios";
import { useMutation } from "@tanstack/react-query";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { ErrorMessage } from "@/components/ErrorMessage.tsx";
import { getErrorMessage } from "@/lib/api-error.ts";
import type { Ticket } from "@/lib/ticket-display.ts";

// Nothing is cached/persisted client-side either — every click re-mutates,
// so the summary reflects whatever the reply thread looks like right now
// rather than a stale one from an earlier click.
export function TicketSummary({ ticket }: { ticket: Ticket }) {
  const summarize = useMutation({
    mutationFn: async () => {
      const { data } = await axios.post<{ summary: string }>(
        `/api/tickets/${ticket.id}/summarize`,
      );
      return data.summary;
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={summarize.isPending}
        onClick={() => summarize.mutate()}
      >
        <SparklesIcon className="size-4" />
        {summarize.isPending
          ? "Summarizing..."
          : summarize.data
            ? "Regenerate summary"
            : "Summarize"}
      </Button>
      <ErrorMessage
        message={
          summarize.isError
            ? getErrorMessage(summarize.error, "Could not summarize this ticket. Please try again.")
            : null
        }
      />
      {summarize.data && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap text-foreground">
          {summarize.data}
        </div>
      )}
    </div>
  );
}
