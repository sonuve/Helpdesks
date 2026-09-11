import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { categoryLabels, statusBadgeVariant, type Ticket } from "@/lib/ticket-display.ts";

export function TicketDetailPage() {
  const { id } = useParams();

  const { data, isPending, isError } = useQuery({
    queryKey: ["ticket", id],
    queryFn: async () => {
      const { data } = await axios.get<{ ticket: Ticket }>(`/api/tickets/${id}`);
      return data.ticket;
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
              <Badge variant={statusBadgeVariant[data.status]}>{data.status}</Badge>
              <span>{data.category ? categoryLabels[data.category] : "Unclassified"}</span>
              <span>{data.requesterEmail}</span>
              <span>Created {new Date(data.createdAt).toLocaleString()}</span>
            </div>
            <p className="whitespace-pre-wrap text-foreground">{data.body}</p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
