import { CreateUserDialog } from "./CreateUserDialog.tsx";
import { UsersTable } from "./UsersTable.tsx";

export function UsersPage() {
  return (
    <section className="flex flex-grow flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-medium tracking-tight text-foreground">Users</h1>
        <CreateUserDialog />
      </div>

      <UsersTable />
    </section>
  );
}
