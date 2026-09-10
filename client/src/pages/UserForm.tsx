import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { createUserSchema, updateUserSchema, Role, type CreateUserInput } from "core";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button.tsx";
import { DialogFooter } from "@/components/ui/dialog.tsx";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";

// `updateUserSchema` (blank-password-allowed) infers to the same shape as
// `CreateUserInput`, so one type covers both modes' form values.
type UserFormValues = CreateUserInput;

type UserFormProps =
  | { mode: "create"; onSuccess: () => void }
  | {
      mode: "edit";
      userId: string;
      defaultValues: { name: string; email: string; role: Role };
      onSuccess: () => void;
    };

export function UserForm(props: UserFormProps) {
  const { mode, onSuccess } = props;
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<UserFormValues>({
    resolver: zodResolver(mode === "create" ? createUserSchema : updateUserSchema),
    defaultValues: mode === "edit" ? { ...props.defaultValues, password: "" } : undefined,
  });

  const saveUser = useMutation({
    mutationFn: async (values: UserFormValues) => {
      const { data } =
        mode === "create"
          ? await axios.post("/api/users", values)
          : await axios.patch(`/api/users/${props.userId}`, values);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      setError(null);
      onSuccess();
    },
    onError: (mutationError) => {
      const message =
        (axios.isAxiosError(mutationError) && mutationError.response?.data?.error) ||
        `Could not ${mode === "create" ? "create" : "update"} user. Please try again.`;
      setError(message);
    },
  });

  function onSubmit(values: UserFormValues) {
    saveUser.mutate(values);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} autoComplete="off">
      <FieldGroup>
        {error && (
          <p role="alert" className="text-sm font-normal text-destructive">
            {error}
          </p>
        )}
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          {/* autoComplete="off" — a value of "name" here is exactly the
              Chrome profile-autofill token, and this field is for a new
              user's name, not the signed-in admin's own. */}
          <Input id="name" autoComplete="off" aria-invalid={!!errors.name} {...register("name")} />
          <FieldError errors={errors.name ? [errors.name] : undefined} />
        </Field>
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="off"
            aria-invalid={!!errors.email}
            {...register("email")}
          />
          <FieldError errors={errors.email ? [errors.email] : undefined} />
        </Field>
        <Field data-invalid={!!errors.role}>
          <FieldLabel htmlFor="role">Role</FieldLabel>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Select value={field.value ?? ""} onValueChange={field.onChange}>
                <SelectTrigger id="role" className="w-full" aria-invalid={!!errors.role}>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Role.AGENT}>Agent</SelectItem>
                  <SelectItem value={Role.ADMIN}>Admin</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <FieldError errors={errors.role ? [errors.role] : undefined} />
        </Field>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          {/* "new-password" (not "off", which Chrome ignores for
              password fields) is the standard token for stopping the
              browser from offering to fill the admin's own saved
              password here. */}
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          {mode === "edit" && (
            <FieldDescription>Leave blank to keep the current password.</FieldDescription>
          )}
          <FieldError errors={errors.password ? [errors.password] : undefined} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={saveUser.isPending}>
          {mode === "create"
            ? saveUser.isPending
              ? "Creating..."
              : "Create user"
            : saveUser.isPending
              ? "Saving..."
              : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
