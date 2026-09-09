import { useEffect, useState } from "react";

export function HomePage() {
  const [healthMessage, setHealthMessage] = useState("Checking API health...");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: { status: string }) => setHealthMessage(`API status: ${data.status}`))
      .catch(() => setHealthMessage("Could not reach the API — is the server running?"));
  }, []);

  return (
    <section className="flex flex-grow flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-5xl font-medium tracking-tight text-foreground">Helpdesks</h1>
      <p className="text-muted-foreground">{healthMessage}</p>
    </section>
  );
}
