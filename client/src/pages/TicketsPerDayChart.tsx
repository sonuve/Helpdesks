import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ErrorMessage } from "@/components/ErrorMessage.tsx";
import { formatChartDate, type TicketStats } from "../lib/ticket-display.ts";

const chartConfig = {
  count: { label: "Tickets", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function TicketsPerDayChart() {
  // Same queryKey as DashboardStats.tsx's own useQuery for GET
  // /api/tickets/stats — TanStack Query dedupes identical concurrent
  // queries against one cache entry, so the two components mounting
  // together (DashboardPage.tsx) only ever cost one request, without this
  // component needing to reach into DashboardStats.tsx for the data or the
  // two being merged into one god component.
  const { data, isPending, isError } = useQuery({
    queryKey: ["tickets", "stats"],
    queryFn: async () => {
      const { data } = await axios.get<TicketStats>("/api/tickets/stats");
      return data;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tickets per day (last 30 days)</CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <ErrorMessage message="Could not load the tickets-per-day chart — is the server running?" />
        ) : isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
            <BarChart data={data.ticketsPerDay.map((d) => ({ ...d, label: formatChartDate(d.date) }))}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval="preserveStartEnd"
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
