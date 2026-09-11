import { Role } from "core";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { authClient } from "../lib/auth-client.ts";
import { useAuth } from "../hooks/useAuth.ts";

export function NavBar() {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await authClient.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <nav className="flex items-center justify-between border-b border-border bg-white px-6 py-4">
      <div className="flex items-center gap-4">
        <Link to="/" className="font-semibold text-foreground">
          Helpdesks
        </Link>
        <Button asChild type="button" variant="ghost" size="sm">
          <Link to="/tickets">Tickets</Link>
        </Button>
        {user?.role === Role.ADMIN && (
          <Button asChild type="button" variant="ghost" size="sm">
            <Link to="/users">Users</Link>
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">{user?.name}</span>
        <Button type="button" variant="outline" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    </nav>
  );
}
