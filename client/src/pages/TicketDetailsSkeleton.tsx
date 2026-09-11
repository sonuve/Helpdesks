import { Skeleton } from "@/components/ui/skeleton.tsx";

export function TicketDetailsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-8 w-96" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
