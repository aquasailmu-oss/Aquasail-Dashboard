import { PlusIcon, ShipIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BookingStatusBadge } from "@/components/shared/booking-status-badge";
import { PaymentStatusBadge } from "@/components/shared/payment-status-badge";
import { BookingSearch } from "@/components/today/booking-search";
import { TodayRefresher } from "@/components/today/today-refresher";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { businessDate, businessDayBounds, formatDateLong, formatTime } from "@/lib/dates";
import { cents, formatRs } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { RegisterRow } from "@/lib/register";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Today · AquaSail Ops" };

type TodayRow = Pick<
  RegisterRow,
  | "id"
  | "reference"
  | "departure_time"
  | "client_name"
  | "summary"
  | "people"
  | "charged_total_cents"
  | "balance_cents"
  | "payment_status"
  | "status"
  | "operator_name"
  | "payer"
  | "resource_id"
>;

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="text-muted-foreground text-sm font-semibold">{label}</div>
        <div className="font-display mt-1 text-3xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-muted-foreground text-sm">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default async function TodayPage() {
  const user = await requireRole(["admin", "accountant", "receptionist"]);
  const today = businessDate();
  const { start, end } = businessDayBounds(today);
  const supabase = await createClient();

  const [bookings, cash, entitlements, boats] = await Promise.all([
    supabase
      .from("booking_register")
      .select(
        "id, reference, departure_time, client_name, summary, people, charged_total_cents, balance_cents, payment_status, status, operator_name, payer, resource_id",
      )
      .eq("service_date", today)
      .order("departure_time", { ascending: true, nullsFirst: false })
      .order("created_at")
      .overrideTypes<TodayRow[], { merge: false }>(),
    supabase
      .from("payments")
      .select("amount_cents")
      .eq("method", "cash")
      .gte("received_at", start)
      .lt("received_at", end),
    supabase
      .from("booking_activities")
      .select("quantity, activities(name, sort_order), bookings!inner(service_date, status)")
      .eq("bookings.service_date", today)
      .neq("bookings.status", "cancelled"),
    supabase.from("resources").select("id, name, capacity").eq("is_active", true).order("sort_order"),
  ]);
  if (bookings.error || cash.error || entitlements.error || boats.error) {
    return (
      <Alert variant="destructive">Today&rsquo;s figures could not be loaded. Refresh the page to try again.</Alert>
    );
  }

  const live = bookings.data.filter((b) => b.status !== "cancelled");
  const people = live.reduce((s, b) => s + b.people, 0);
  const charged = live.reduce((s, b) => s + b.charged_total_cents, 0);
  const outstanding = live.filter((b) => b.payer === "client").reduce((s, b) => s + Math.max(0, b.balance_cents), 0);
  const onAccount = live.filter((b) => b.payer === "operator");
  const receivable = onAccount.reduce((s, b) => s + b.charged_total_cents, 0);
  const cashIn = cash.data.reduce((s, p) => s + p.amount_cents, 0);

  const byActivity = new Map<string, { name: string; order: number; count: number }>();
  for (const e of entitlements.data) {
    if (!e.activities) continue;
    const row = byActivity.get(e.activities.name) ?? {
      name: e.activities.name,
      order: e.activities.sort_order,
      count: 0,
    };
    row.count += e.quantity;
    byActivity.set(e.activities.name, row);
  }
  const activityRows = [...byActivity.values()].sort((a, b) => a.order - b.order);
  const load = new Map<string, number>();
  for (const b of live) if (b.resource_id) load.set(b.resource_id, (load.get(b.resource_id) ?? 0) + b.people);

  return (
    <>
      <TodayRefresher />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          {user.role !== "accountant" && (
            <Button asChild size="lg">
              {/* Focused on arrival: Enter starts a booking for the customer at the desk. */}
              <Link href="/bookings/new" autoFocus>
                <PlusIcon /> New booking
              </Link>
            </Button>
          )}
          <div>
            <h1 className="font-display text-3xl font-semibold">Today</h1>
            <p className="text-muted-foreground">{formatDateLong(today)}</p>
          </div>
        </div>
        <BookingSearch />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Bookings" value={String(live.length)} />
        <Kpi label="People" value={String(people)} />
        <Kpi label="Charged" value={formatRs(cents(charged))} />
        <Kpi label="Cash collected" value={formatRs(cents(cashIn))} hint="Cash received today, after corrections" />
        <Kpi label="Outstanding" value={formatRs(cents(outstanding))} hint="Still to collect from customers" />
        <Kpi
          label="Operator account"
          value={String(onAccount.length)}
          hint={`${formatRs(cents(receivable))} receivable`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="overflow-x-auto">
          {bookings.data.length === 0 ? (
            <p className="text-muted-foreground p-10 text-center">No bookings for today yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Booked</TableHead>
                  <TableHead className="text-right">People</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.data.map((b) => (
                  <TableRow
                    key={b.id}
                    className={cn("relative", b.status === "cancelled" && "text-muted-foreground line-through")}
                  >
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {b.departure_time ? formatTime(b.departure_time) : "—"}
                    </TableCell>
                    <TableCell className="font-mono whitespace-nowrap">
                      <Link
                        href={`/bookings/${b.id}`}
                        className="text-accent-foreground after:absolute after:inset-0 hover:underline"
                      >
                        {b.reference}
                      </Link>
                    </TableCell>
                    <TableCell>{b.client_name}</TableCell>
                    <TableCell>{b.summary}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.people}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRs(cents(b.charged_total_cents))}</TableCell>
                    <TableCell>
                      {b.status === "cancelled" ? (
                        <BookingStatusBadge status="cancelled" />
                      ) : (
                        <PaymentStatusBadge status={b.payment_status} />
                      )}
                    </TableCell>
                    <TableCell>{b.operator_name ?? "Walk-in"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Fleet</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {boats.data.map((r) => {
                const n = load.get(r.id) ?? 0;
                const pct = Math.min(100, Math.round((n / r.capacity) * 100));
                return (
                  <div key={r.id}>
                    <div className="flex justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold">
                        <ShipIcon className="size-4" aria-hidden /> {r.name}
                      </span>
                      <span className={cn("tabular-nums", n > r.capacity && "text-destructive font-semibold")}>
                        {n} / {r.capacity}
                      </span>
                    </div>
                    <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full" aria-hidden>
                      <div
                        className={cn("h-full", n > r.capacity ? "bg-destructive" : "bg-brand-mid")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Activities today</CardTitle>
            </CardHeader>
            <CardContent>
              {activityRows.length === 0 ? (
                <p className="text-muted-foreground">Nothing booked yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {activityRows.map((a) => (
                    <li key={a.name} className="flex justify-between">
                      <span>{a.name}</span>
                      <span className="font-semibold tabular-nums">{a.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
