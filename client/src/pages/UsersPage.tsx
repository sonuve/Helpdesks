import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";

type UserRole = "ADMIN" | "AGENT";

type UserListItem = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  createdAt: string;
};

export function UsersPage() {
  const [users, setUsers] = useState<UserListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/users")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load users (${res.status})`);
        }
        return (await res.json()) as { users: UserListItem[] };
      })
      .then((data) => {
        if (!cancelled) setUsers(data.users);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load users — is the server running?");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-grow flex-col gap-6 p-8">
      <h1 className="text-3xl font-medium tracking-tight text-foreground">Users</h1>

      {error && <p className="text-destructive">{error}</p>}

      {!error && !users && <p className="text-muted-foreground">Loading users…</p>}

      {!error && users && users.length === 0 && (
        <p className="text-muted-foreground">No users found.</p>
      )}

      {!error && users && users.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                    {user.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.emailVerified ? (
                    <Badge variant="outline">Verified</Badge>
                  ) : (
                    <Badge variant="destructive">Unverified</Badge>
                  )}
                </TableCell>
                <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
