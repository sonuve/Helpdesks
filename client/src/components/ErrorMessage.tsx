// Top-level failure message — distinct from FieldError (components/ui/
// field.tsx), which renders a single field's react-hook-form validation
// errors. This covers two cases: a whole-form/whole-mutation failure
// (LoginPage, UserForm, DeleteUserDialog, ReplyForm all render one above
// their fields for a failed request) and a whole-view query failure
// (UsersTable, TicketsTable, TicketDetailPage, HomePage render one in place
// of their content when the fetch itself errors) — same "render one string,
// nothing if it's falsy" shape either way.
export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p role="alert" className="text-sm font-normal text-destructive">
      {message}
    </p>
  );
}
