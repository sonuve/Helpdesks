import axios from "axios";
import { TicketCategory, TicketStatus } from "core";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";

type TicketListItem = {
  id: number;
  status: TicketStatus;
  category: TicketCategory | null;
  subject: string;
  requesterEmail: string;
  createdAt: string;
};

// A query param, not a real TicketCategory value — "category is null" has
// to be expressed as *something* in a query string. Mirrors the server's
// own sentinel (server/src/routes/tickets.ts).
const UNCLASSIFIED = "UNCLASSIFIED";
// Sentinel meaning "no filter" — shadcn's Select can't use "" as an
// Item value (Radix reserves it for "nothing selected"), so this stands
// in for "don't send this param at all."
const ALL = "ALL";

const categoryLabels: Record<TicketCategory, string> = {
  [TicketCategory.GENERAL_QUESTION]: "General Question",
  [TicketCategory.TECHNICAL_QUESTION]: "Technical Question",
  [TicketCategory.REFUND_REQUEST]: "Refund Request",
};

const statusBadgeVariant: Record<TicketStatus, "default" | "secondary" | "outline"> = {
  [TicketStatus.OPEN]: "default",
  [TicketStatus.RESOLVED]: "secondary",
  [TicketStatus.CLOSED]: "outline",
};

// column.id matches GET /api/tickets' sortBy allow-list (server/src/routes/
// tickets.ts) — both name the same Ticket fields, since a click here turns
// directly into that query param.
function SortableHeader({ label, column }: { label: string; column: Column<TicketListItem> }) {
  const sorted = column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : ArrowUpDownIcon;

  return (
    <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={column.getToggleSortingHandler()}>
      {label}
      <Icon className="ml-1.5 size-3.5 text-muted-foreground" />
    </Button>
  );
}

const columns: ColumnDef<TicketListItem>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => <SortableHeader label="ID" column={column} />,
    cell: ({ row }) => <span className="font-medium">#{row.original.id}</span>,
  },
  {
    accessorKey: "subject",
    header: ({ column }) => <SortableHeader label="Subject" column={column} />,
  },
  {
    accessorKey: "requesterEmail",
    header: ({ column }) => <SortableHeader label="Requester" column={column} />,
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortableHeader label="Status" column={column} />,
    cell: ({ row }) => (
      <Badge variant={statusBadgeVariant[row.original.status]}>{row.original.status}</Badge>
    ),
  },
  {
    accessorKey: "category",
    header: ({ column }) => <SortableHeader label="Category" column={column} />,
    cell: ({ row }) =>
      row.original.category ? (
        categoryLabels[row.original.category]
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => <SortableHeader label="Created" column={column} />,
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
  },
];

export function TicketsTable() {
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | typeof ALL>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<
    TicketCategory | typeof UNCLASSIFIED | typeof ALL
  >(ALL);
  const sort = sorting[0];

  const { data: tickets, isPending, isError } = useQuery({
    queryKey: ["tickets", sort, statusFilter, categoryFilter],
    queryFn: async () => {
      // Sorting and filtering both happen on the server: these params are
      // passed straight through to GET /api/tickets (see server/src/routes/
      // tickets.ts), and the response is rendered as-is — never re-sorted
      // or re-filtered here.
      const { data } = await axios.get<{ tickets: TicketListItem[] }>("/api/tickets", {
        params: {
          ...(sort ? { sortBy: sort.id, sortOrder: sort.desc ? "desc" : "asc" } : {}),
          ...(statusFilter !== ALL ? { status: statusFilter } : {}),
          ...(categoryFilter !== ALL ? { category: categoryFilter } : {}),
        },
      });
      return data.tickets;
    },
  });

  const table = useReactTable({
    data: tickets ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as TicketStatus | typeof ALL)}
        >
          <SelectTrigger aria-label="Filter by status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value={TicketStatus.OPEN}>Open</SelectItem>
            <SelectItem value={TicketStatus.RESOLVED}>Resolved</SelectItem>
            <SelectItem value={TicketStatus.CLOSED}>Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={categoryFilter}
          onValueChange={(value) =>
            setCategoryFilter(value as TicketCategory | typeof UNCLASSIFIED | typeof ALL)
          }
        >
          <SelectTrigger aria-label="Filter by category" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            <SelectItem value={TicketCategory.GENERAL_QUESTION}>General Question</SelectItem>
            <SelectItem value={TicketCategory.TECHNICAL_QUESTION}>Technical Question</SelectItem>
            <SelectItem value={TicketCategory.REFUND_REQUEST}>Refund Request</SelectItem>
            <SelectItem value={UNCLASSIFIED}>Unclassified</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <p className="text-destructive">Could not load tickets — is the server running?</p>
      ) : isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <p className="text-muted-foreground">No tickets found.</p>
      ) : (
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
