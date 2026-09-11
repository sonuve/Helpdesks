import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ErrorMessage } from "@/components/ErrorMessage.tsx";

export function HomePage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data } = await axios.get<{ status: string }>("/api/health");
      return data;
    },
  });

  return (
    <section className="flex flex-grow flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-5xl font-medium tracking-tight text-foreground">Helpdesks</h1>
      {isPending ? (
        <Skeleton className="h-5 w-56" />
      ) : isError ? (
        <ErrorMessage message="Could not reach the API — is the server running?" />
      ) : (
        <p className="text-muted-foreground">API status: {data.status}</p>
      )}
    </section>
  );
}
