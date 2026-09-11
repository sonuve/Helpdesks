import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { createReplySchema, type CreateReplyInput } from "core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button.tsx";
import { Field, FieldError } from "@/components/ui/field.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { ErrorMessage } from "@/components/ErrorMessage.tsx";
import { getErrorMessage } from "@/lib/api-error.ts";
import type { Ticket } from "@/lib/ticket-display.ts";

export function ReplyForm({ ticket }: { ticket: Ticket }) {
  const queryClient = useQueryClient();
  const [replyError, setReplyError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateReplyInput>({
    resolver: zodResolver(createReplySchema),
    defaultValues: { body: "" },
  });

  const addReply = useMutation({
    mutationFn: async (values: CreateReplyInput) => {
      const { data } = await axios.post(`/api/tickets/${ticket.id}/replies`, values);
      return data;
    },
    onSuccess: () => {
      reset();
      setReplyError(null);
      queryClient.invalidateQueries({ queryKey: ["ticket", ticket.id] });
    },
    onError: (mutationError) => {
      setReplyError(getErrorMessage(mutationError, "Could not send reply. Please try again."));
    },
  });

  function onSubmit(values: CreateReplyInput) {
    addReply.mutate(values);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2">
      <ErrorMessage message={replyError} />
      <Field data-invalid={!!errors.body}>
        <Textarea
          aria-label="Reply"
          placeholder="Write a reply..."
          aria-invalid={!!errors.body}
          {...register("body")}
        />
        <FieldError errors={errors.body ? [errors.body] : undefined} />
      </Field>
      <Button type="submit" className="self-end" disabled={addReply.isPending}>
        {addReply.isPending ? "Sending..." : "Send reply"}
      </Button>
    </form>
  );
}
