import axios from "axios";
import { TicketCategory, TicketStatus } from "core";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
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
import { ErrorMessage } from "@/components/ErrorMessage.tsx";
import {
  categoryLabels,
  statusBadgeVariant,
  statusLabels,
  type Ticket,
} from "@/lib/ticket-display.ts";

// The list only ever renders these fields — pagination fetches page-sized
// batches, so `body`/`updatedAt` (only needed on the single-ticket detail
// page) would just be wasted payload here.
type TicketListItem = Omit<Ticket, "body" | "updatedAt" | "replies">;

// A query param, not a real TicketCategory value — "category is null" has
// to be expressed as *something* in a query string. Mirrors the server's
// own sentinel (server/src/routes/tickets.ts).
const UNCLASSIFIED = "UNCLASSIFIED";
// Sentinel meaning "no filter" — shadcn's Select can't use "" as an
// Item value (Radix reserves it for "nothing selected"), so this stands
// in for "don't send this param at all."
const ALL = "ALL";

const DEFAULT_PAGE_SIZE = 10;

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
    cell: ({ row }) => (
      <Link to={`/tickets/${row.original.id}`} className="hover:underline">
        {row.original.subject}
      </Link>
    ),
  },
  {
    accessorKey: "requesterEmail",
    header: ({ column }) => <SortableHeader label="Requester" column={column} />,
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortableHeader label="Status" column={column} />,
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <Badge variant={statusBadgeVariant[row.original.status]}>
          {statusLabels[row.original.status]}
        </Badge>
        {row.original.resolvedByAi && (
          <Badge variant="outline" className="gap-1">
            <SparklesIcon className="size-3" />
            AI
          </Badge>
        )}
      </div>
    ),
  },
  {
    accessorKey: "category",
    header: ({ column }) => <SortableHeader label="Category" column={column} />,
    cell: ({ row }) =>
      row.original.category ? (
        <Badge variant="outline">{categoryLabels[row.original.category]}</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    // Not sortable — assignedTo isn't in GET /api/tickets' sortBy
    // allow-list, so this is a plain header (no SortableHeader) rather
    // than one that looks clickable but does nothing.
    id: "assignedTo",
    header: "Assignee",
    cell: ({ row }) =>
      row.original.assignedTo ? (
        row.original.assignedTo.name
      ) : (
        <span className="text-muted-foreground">Unassigned</span>
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
  // "YYYY-MM-DD" (an <input type="date">'s native value format) or "" for
  // unset — sent to the server as-is, which coerces it and expands
  // createdTo to the end of that day (server/src/routes/tickets.ts).
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const sort = sorting[0];

  // Changing sort/filters without resetting the page can strand the user
  // on a page number that no longer exists for the new result set (e.g.
  // page 4 of a filter that now only has 1 page).
  function backToFirstPage() {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }

  const { data, isPending, isError } = useQuery({
    queryKey: [
      "tickets",
      sort,
      statusFilter,
      categoryFilter,
      createdFrom,
      createdTo,
      pagination,
    ],
    queryFn: async () => {
      // Sorting, filtering, and pagination all happen on the server: these
      // params are passed straight through to GET /api/tickets (see
      // server/src/routes/tickets.ts), and the response — one page's worth
      // of tickets, plus the total count across all pages — is rendered
      // as-is, never re-sorted/re-filtered/re-paginated here.
      const { data } = await axios.get<{ tickets: TicketListItem[]; total: number }>(
        "/api/tickets",
        {
          params: {
            ...(sort ? { sortBy: sort.id, sortOrder: sort.desc ? "desc" : "asc" } : {}),
            ...(statusFilter !== ALL ? { status: statusFilter } : {}),
            ...(categoryFilter !== ALL ? { category: categoryFilter } : {}),
            ...(createdFrom ? { createdFrom } : {}),
            ...(createdTo ? { createdTo } : {}),
            page: pagination.pageIndex + 1,
            pageSize: pagination.pageSize,
          },
        },
      );
      return data;
    },
  });
  const tickets = data?.tickets;
  const total = data?.total ?? 0;

  const table = useReactTable({
    data: tickets ?? [],
    columns,
    state: { sorting, pagination },
    onSortingChange: (updater) => {
      setSorting(updater);
      backToFirstPage();
    },
    onPaginationChange: setPagination,
    manualSorting: true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(total / pagination.pageSize)),
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as TicketStatus | typeof ALL);
            backToFirstPage();
          }}
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
          onValueChange={(value) => {
            setCategoryFilter(value as TicketCategory | typeof UNCLASSIFIED | typeof ALL);
            backToFirstPage();
          }}
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
        <Input
          type="date"
          aria-label="Filter by created from date"
          className="w-40"
          value={createdFrom}
          onChange={(e) => {
            setCreatedFrom(e.target.value);
            backToFirstPage();
          }}
        />
        <Input
          type="date"
          aria-label="Filter by created to date"
          className="w-40"
          value={createdTo}
          onChange={(e) => {
            setCreatedTo(e.target.value);
            backToFirstPage();
          }}
        />
      </div>

      {isError ? (
        <ErrorMessage message="Could not load tickets — is the server running?" />
      ) : isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !tickets || tickets.length === 0 ? (
        <p className="text-muted-foreground">No tickets found.</p>
      ) : (
        <>
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
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {pagination.pageIndex + 1} of {table.getPageCount()} ({total} ticket
              {total === 1 ? "" : "s"})
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
