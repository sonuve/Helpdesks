import type { Role } from "core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { UserForm } from "./UserForm.tsx";

type EditUserDialogProps = {
  user: { id: string; name: string; email: string; role: Role } | null;
  onOpenChange: (open: boolean) => void;
};

export function EditUserDialog({ user, onOpenChange }: EditUserDialogProps) {
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
        </DialogHeader>
        {user && (
          // Keyed on the user so switching who's being edited (without the
          // dialog fully unmounting in between) remounts the form with
          // fresh defaultValues instead of keeping the previous user's.
          <UserForm
            key={user.id}
            mode="edit"
            userId={user.id}
            defaultValues={{ name: user.name, email: user.email, role: user.role }}
            onSuccess={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
