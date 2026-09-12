import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { ClockIcon, InboxIcon, PercentIcon, SparklesIcon, TicketIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ErrorMessage } from "@/components/ErrorMessage.tsx";
import { formatDuration, type TicketStats } from "../lib/ticket-display.ts";

type StatCard = {
  label: string;
  value: string;
  icon: typeof TicketIcon;
};

function statCardsFrom(stats: TicketStats): StatCard[] {
  return [
    { label: "Total tickets", value: stats.totalTickets.toLocaleString(), icon: TicketIcon },
    { label: "Open tickets", value: stats.openTickets.toLocaleString(), icon: InboxIcon },
    {
      label: "Resolved by AI",
      value: stats.resolvedByAiCount.toLocaleString(),
      icon: SparklesIcon,
    },
    {
      label: "Resolved by AI",
      value: `${stats.resolvedByAiPercent.toFixed(1)}%`,
      icon: PercentIcon,
    },
    {
      label: "Avg. resolution time",
      value:
        stats.averageResolutionTimeMs === null
          ? "—"
          : formatDuration(stats.averageResolutionTimeMs),
      icon: ClockIcon,
    },
  ];
}

export function DashboardStats() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["tickets", "stats"],
    queryFn: async () => {
      const { data } = await axios.get<TicketStats>("/api/tickets/stats");
      return data;
    },
  });

  if (isError) {
    return <ErrorMessage message="Could not load dashboard stats — is the server running?" />;
  }

  if (isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {statCardsFrom(data).map(({ label, value, icon: Icon }, i) => (
        <Card key={i}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted-foreground">
              <Icon className="size-4" />
              {label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
