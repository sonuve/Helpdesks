import axios from "axios";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";

type DeleteUserDialogProps = {
  user: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
};

export function DeleteUserDialog({ user, onOpenChange }: DeleteUserDialogProps) {
  return (
    <AlertDialog open={user !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {user && (
          <DeleteUserDialogBody
            key={user.id}
            user={user}
            onDeleted={() => onOpenChange(false)}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Split out so `user` is non-null here — it only mounts once the dialog
// actually has a target, mirroring UserForm only mounting inside
// EditUserDialog's own `user &&` guard.
function DeleteUserDialogBody({
  user,
  onDeleted,
}: {
  user: { id: string; name: string };
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const deleteUser = useMutation({
    mutationFn: async () => {
      await axios.delete(`/api/users/${user.id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      setError(null);
      onDeleted();
    },
    onError: (mutationError) => {
      const message =
        (axios.isAxiosError(mutationError) && mutationError.response?.data?.error) ||
        "Could not delete user. Please try again.";
      setError(message);
    },
  });

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {user.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          They'll immediately lose access. This is a soft delete — their account and history are
          kept, just hidden.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {error && (
        <p role="alert" className="text-sm font-normal text-destructive">
          {error}
        </p>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          disabled={deleteUser.isPending}
          onClick={(event) => {
            // AlertDialogAction is a Dialog.Close under the hood, so it
            // closes immediately on click unless we prevent that default
            // and close ourselves only once the delete actually succeeds
            // — otherwise a failed delete would silently close anyway.
            event.preventDefault();
            deleteUser.mutate();
          }}
        >
          {deleteUser.isPending ? "Deleting..." : "Delete"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
