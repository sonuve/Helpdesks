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
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateReplyInput>({
    resolver: zodResolver(createReplySchema),
    defaultValues: { body: "" },
  });
  const draft = watch("body");

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

  // Drafts a reply from scratch, grounded in the ticket itself — for when
  // there's no draft yet to polish. Same "nothing persisted" shape as
  // polishReply below.
  const generateReply = useMutation({
    mutationFn: async () => {
      const { data } = await axios.post<{ body: string }>(
        `/api/tickets/${ticket.id}/generate-reply`,
      );
      return data.body;
    },
    onSuccess: (generated) => {
      setValue("body", generated, { shouldValidate: true, shouldDirty: true });
      setReplyError(null);
    },
    onError: (mutationError) => {
      setReplyError(getErrorMessage(mutationError, "Could not generate a reply. Please try again."));
    },
  });

  // Improves the draft in place — nothing is sent/persisted here, unlike
  // addReply. The agent still has to review the result and hit "Send
  // reply" themselves.
  const polishReply = useMutation({
    mutationFn: async (body: string) => {
      const { data } = await axios.post<{ body: string }>(
        `/api/tickets/${ticket.id}/polish-reply`,
        { body },
      );
      return data.body;
    },
    onSuccess: (polished) => {
      setValue("body", polished, { shouldValidate: true, shouldDirty: true });
      setReplyError(null);
    },
    onError: (mutationError) => {
      setReplyError(getErrorMessage(mutationError, "Could not polish this reply. Please try again."));
    },
  });

  function onSubmit(values: CreateReplyInput) {
    addReply.mutate(values);
  }

  const isBusy = addReply.isPending || polishReply.isPending || generateReply.isPending;

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
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isBusy}
          onClick={() => generateReply.mutate()}
        >
          {generateReply.isPending ? "Generating..." : "Generate reply"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!draft?.trim() || isBusy}
          onClick={() => polishReply.mutate(draft)}
        >
          {polishReply.isPending ? "Polishing..." : "Polish"}
        </Button>
        <Button type="submit" disabled={isBusy}>
          {addReply.isPending ? "Sending..." : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
