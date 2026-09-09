import { authClient } from "../lib/auth-client.ts";

export function useAuth() {
  const { data, isPending } = authClient.useSession();

  return {
    user: data?.user ?? null,
    isPending,
    isAuthenticated: data?.user != null,
  };
}
