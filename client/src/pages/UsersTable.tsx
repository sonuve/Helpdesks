import axios from "axios";
import { Role } from "core";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ErrorMessage } from "@/components/ErrorMessage.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { DeleteUserDialog } from "./DeleteUserDialog.tsx";
import { EditUserDialog } from "./EditUserDialog.tsx";

type UserListItem = {
  id: string;
  name: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  createdAt: string;
};

export function UsersTable() {
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserListItem | null>(null);
  const { data: users, isPending, isError } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data } = await axios.get<{ users: UserListItem[] }>("/api/users");
      return data.users;
    },
  });

  if (isError) {
    return <ErrorMessage message="Could not load users — is the server running?" />;
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (users.length === 0) {
    return <p className="text-muted-foreground">No users found.</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Verified</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.name}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Badge variant={user.role === Role.ADMIN ? "default" : "secondary"}>
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
              <TableCell>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditingUser(user)}>
                    <PencilIcon />
                    <span className="sr-only">Edit {user.name}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={user.role === Role.ADMIN}
                    onClick={() => setDeletingUser(user)}
                  >
                    <Trash2Icon />
                    <span className="sr-only">
                      {user.role === Role.ADMIN ? "Admins cannot be deleted" : `Delete ${user.name}`}
                    </span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <EditUserDialog
        user={editingUser}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}
      />
      <DeleteUserDialog
        user={deletingUser}
        onOpenChange={(open) => {
          if (!open) setDeletingUser(null);
        }}
      />
    </>
  );
}
