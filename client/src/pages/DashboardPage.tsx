import { DashboardStats } from "./DashboardStats.tsx";
import { TicketsPerDayChart } from "./TicketsPerDayChart.tsx";

export function DashboardPage() {
  return (
    <section className="flex flex-grow flex-col gap-6 p-8">
      <h1 className="text-3xl font-medium tracking-tight text-foreground">Dashboard</h1>
      <DashboardStats />
      <TicketsPerDayChart />
    </section>
  );
}
