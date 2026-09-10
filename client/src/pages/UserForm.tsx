import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { createUserSchema, type CreateUserInput } from "core";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button.tsx";
import { DialogFooter } from "@/components/ui/dialog.tsx";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";

type UserFormProps = {
  onSuccess: () => void;
};

export function UserForm({ onSuccess }: UserFormProps) {
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({ resolver: zodResolver(createUserSchema) });

  const createUser = useMutation({
    mutationFn: async (values: CreateUserInput) => {
      const { data } = await axios.post("/api/users", values);
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
        "Could not create user. Please try again.";
      setError(message);
    },
  });

  function onSubmit(values: CreateUserInput) {
    createUser.mutate(values);
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
          <FieldError errors={errors.password ? [errors.password] : undefined} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create user"}
        </Button>
      </DialogFooter>
    </form>
  );
}
