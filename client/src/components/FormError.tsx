// Top-level mutation/submit failure message — distinct from FieldError
// (components/ui/field.tsx), which renders a single field's react-hook-form
// validation errors. This is the whole-form/whole-mutation counterpart:
// LoginPage, UserForm, DeleteUserDialog, and TicketDetailPage's reply form
// all render one of these above their fields for a failed request.
export function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p role="alert" className="text-sm font-normal text-destructive">
      {message}
    </p>
  );
}
