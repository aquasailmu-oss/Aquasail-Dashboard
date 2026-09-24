import { ArrowDownIcon, ArrowUpIcon, FileSpreadsheetIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BookingStatusBadge } from "@/components/shared/booking-status-badge";
import { PaymentStatusBadge } from "@/components/shared/payment-status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { formatDateShort } from "@/lib/dates";
import { cents, formatRs } from "@/lib/money";
import {
  filtersToParams,
  parseRegisterFilters,
  registerQuery,
  type RegisterFilters,
  type RegisterRow,
} from "@/lib/register";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bookings · AquaSail Ops" };

const PAGE_SIZE = 50;

type ListRow = Pick<
  RegisterRow,
  | "id"
  | "reference"
  | "service_date"
  | "client_name"
  | "operator_name"
  | "summary"
  | "people"
  | "charged_total_cents"
  | "paid_cents"
  | "balance_cents"
  | "payment_status"
  | "status"
>;
type TotalsRow = Pick<RegisterRow, "status" | "people" | "charged_total_cents" | "paid_cents" | "balance_cents">;

function Select({
  id,
  name,
  label,
  value,
  children,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} name={name} defaultValue={value} className="border-input bg-card min-h-11 rounded-md border px-3">
        {children}
      </select>
    </div>
  );
}

function SortHeader({
  f,
  col,
  label,
  align,
}: {
  f: RegisterFilters;
  col: RegisterFilters["sort"];
  label: string;
  align?: "right";
}) {
  const active = f.sort === col;
  const dir = active && f.dir === "desc" ? "asc" : "desc";
  return (
    <TableHead
      className={align === "right" ? "text-right" : undefined}
      aria-sort={active ? (f.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <Link
        href={`/bookings?${filtersToParams(f, { sort: col, dir, page: 1 })}`}
        className="inline-flex min-h-11 items-center gap-1 hover:underline"
      >
        {label}
        {active && (f.dir === "asc" ? <ArrowUpIcon className="size-4" /> : <ArrowDownIcon className="size-4" />)}
      </Link>
    </TableHead>
  );
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["admin", "accountant", "receptionist"]);
  const f = parseRegisterFilters(await searchParams);
  const supabase = await createClient();

  const [page, totals, operators, packages, activities, creators] = await Promise.all([
    registerQuery(
      supabase,
      f,
      "id, reference, service_date, client_name, operator_name, summary, people, charged_total_cents, paid_cents, balance_cents, payment_status, status",
      "exact",
    )
      .order(f.sort, { ascending: f.dir === "asc" })
      .order("reference", { ascending: f.dir === "asc" })
      .range((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE - 1)
      .overrideTypes<ListRow[], { merge: false }>(),
    registerQuery(supabase, f, "status, people, charged_total_cents, paid_cents, balance_cents").overrideTypes<
      TotalsRow[],
      { merge: false }
    >(),
    supabase.from("tour_operators").select("id, name").order("name"),
    supabase.from("packages").select("id, name").order("name"),
    supabase.from("activities").select("id, name").order("sort_order"),
    supabase.from("booking_register").select("created_by").gte("service_date", f.from).lte("service_date", f.to),
  ]);
  if (page.error || totals.error) {
    return <Alert variant="destructive">Bookings could not be loaded. Refresh the page to try again.</Alert>;
  }
  const creatorIds = [...new Set((creators.data ?? []).map((c) => c.created_by).filter((x): x is string => !!x))];
  const { data: staff } = creatorIds.length ? await supabase.rpc("staff_names", { p_ids: creatorIds }) : { data: [] };

  const live = totals.data.filter((t) => t.status !== "cancelled");
  const sum = (key: "people" | "charged_total_cents" | "paid_cents" | "balance_cents") =>
    live.reduce((s, t) => s + t[key], 0);
  const cancelledCount = totals.data.length - live.length;
  const pages = Math.max(1, Math.ceil((page.count ?? 0) / PAGE_SIZE));
  const canExport = user.role !== "receptionist";

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Every booking. Filters stay in the address, so a view can be bookmarked or shared."
        actions={
          <>
            {canExport && (
              <Button asChild variant="outline">
                <a href={`/bookings/export?${filtersToParams(f, { page: 1 })}`}>
                  <FileSpreadsheetIcon /> Export to Excel
                </a>
              </Button>
            )}
            {user.role !== "accountant" && (
              <Button asChild>
                <Link href="/bookings/new">
                  <PlusIcon /> New booking
                </Link>
              </Button>
            )}
          </>
        }
      />

      <form className="bg-card mb-4 grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="flex flex-col gap-1">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={f.from} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={f.to} />
        </div>
        <Select id="source" name="source" label="Source" value={f.source}>
          <option value="all">All sources</option>
          <option value="walk_in">Walk-in</option>
          {(operators.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Select id="package" name="package" label="Package" value={f.package ?? ""}>
          <option value="">Any package</option>
          {(packages.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select id="activity" name="activity" label="Activity" value={f.activity ?? ""}>
          <option value="">Any activity</option>
          {(activities.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select id="payment" name="payment" label="Payment" value={f.payment ?? ""}>
          <option value="">Any</option>
          <option value="paid">Paid</option>
          <option value="part_paid">Part paid</option>
          <option value="unpaid">Unpaid</option>
          <option value="operator_account">Operator account</option>
        </Select>
        <Select id="status" name="status" label="Status" value={f.status ?? ""}>
          <option value="">Any</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="no_show">No-show</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select id="created_by" name="created_by" label="Created by" value={f.createdBy ?? ""}>
          <option value="">Anyone</option>
          {(staff ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </Select>
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3 xl:col-span-6">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" type="search" defaultValue={f.q} placeholder="Reference, client name or phone" />
        </div>
        <div className="flex items-end gap-2 xl:col-span-2">
          <Button type="submit" className="flex-1">
            Apply filters
          </Button>
          <Button asChild variant="ghost">
            <Link href="/bookings">Reset</Link>
          </Button>
        </div>
      </form>

      <Card className="overflow-x-auto">
        {page.data.length === 0 ? (
          <p className="text-muted-foreground p-10 text-center">No bookings match these filters.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader f={f} col="reference" label="Reference" />
                <SortHeader f={f} col="service_date" label="Date" />
                <SortHeader f={f} col="client_name" label="Client" />
                <TableHead>Source</TableHead>
                <TableHead>Booked</TableHead>
                <SortHeader f={f} col="people" label="People" align="right" />
                <SortHeader f={f} col="charged_total_cents" label="Charged" align="right" />
                <TableHead className="text-right">Paid</TableHead>
                <SortHeader f={f} col="balance_cents" label="Balance" align="right" />
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.data.map((b) => (
                <TableRow
                  key={b.id}
                  className={cn("relative", b.status === "cancelled" && "text-muted-foreground line-through")}
                >
                  <TableCell className="font-mono whitespace-nowrap">
                    <Link
                      href={`/bookings/${b.id}`}
                      className="text-accent-foreground after:absolute after:inset-0 hover:underline"
                    >
                      {b.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateShort(b.service_date)}</TableCell>
                  <TableCell>{b.client_name}</TableCell>
                  <TableCell>{b.operator_name ?? "Walk-in"}</TableCell>
                  <TableCell>{b.summary}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.people}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRs(cents(b.charged_total_cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRs(cents(b.paid_cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRs(cents(b.balance_cents))}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {b.status === "confirmed" ? (
                      <PaymentStatusBadge status={b.payment_status} />
                    ) : (
                      <BookingStatusBadge status={b.status} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5} className="font-semibold">
                  Totals: {live.length} booking{live.length === 1 ? "" : "s"}
                  {cancelledCount > 0 && (
                    <span className="text-muted-foreground font-normal"> (excluding {cancelledCount} cancelled)</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{sum("people")}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatRs(cents(sum("charged_total_cents")))}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatRs(cents(sum("paid_cents")))}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatRs(cents(sum("balance_cents")))}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </Card>
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center gap-3">
          {f.page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/bookings?${filtersToParams(f, { page: f.page - 1 })}`}>Previous</Link>
            </Button>
          )}
          <span className="text-muted-foreground text-sm">
            Page {f.page} of {pages} · {page.count} bookings
          </span>
          {f.page < pages && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/bookings?${filtersToParams(f, { page: f.page + 1 })}`}>Next</Link>
            </Button>
          )}
        </nav>
      )}
    </>
  );
}
