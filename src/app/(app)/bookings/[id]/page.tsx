import { PencilIcon, PrinterIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelBookingDialog, CorrectPaymentDialog, RecordPaymentDialog } from "@/components/booking/booking-dialogs";
import { BookingStatusBadge } from "@/components/shared/booking-status-badge";
import { PayerBanner } from "@/components/shared/payer-banner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { businessDate, formatDateLong, formatDateTime, formatTime } from "@/lib/dates";
import { cents, formatRs } from "@/lib/money";
import { formatRate } from "@/lib/operators";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Booking · AquaSail Ops" };

const TYPE = { adult: "Adult", child: "Child", infant: "Infant" } as const;
const METHOD = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  operator_account: "Operator account",
  other: "Other",
} as const;

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["admin", "accountant", "receptionist"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "*, clients(id, first_name, last_name, phone_e164, email), tour_operators(name, settlement_model), resources(name), booking_items(*, packages(name), activities(name)), booking_participants(participant_type, count), booking_activities(id, quantity, activities(name, sort_order)), payments(*), tickets(token, printed_count)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!b) notFound();

  const staffIds = [b.created_by, b.cancelled_by, ...b.payments.map((p) => p.recorded_by)].filter(
    (x): x is string => !!x,
  );
  const { data: staff } = await supabase.rpc("staff_names", { p_ids: [...new Set(staffIds)] });
  const name = (sid: string | null) => staff?.find((s) => s.id === sid)?.full_name ?? "—";

  const seesMoneyBehind = user.role !== "receptionist"; // operator net and commission (build plan §8)
  const canWrite = user.role !== "accountant";
  const cancelled = b.status === "cancelled";
  const past = b.service_date < businessDate();
  const canAmend = canWrite && !cancelled && (user.role === "admin" || !past);
  const items = [...b.booking_items].sort((a, c) => a.sort_order - c.sort_order);
  const payments = [...b.payments].sort((a, c) => a.received_at.localeCompare(c.received_at));
  const paid = payments.reduce((sum, p) => sum + p.amount_cents, 0);
  const due = b.charged_total_cents - paid;
  const subtotal = items.reduce((sum, i) => sum + i.unit_charged_cents * i.quantity, 0);
  const people = b.booking_participants.map(
    (p) => `${p.count} ${TYPE[p.participant_type].toLowerCase()}${p.count === 1 ? "" : "s"}`,
  );
  const corrected = new Map<string, number>();
  for (const p of payments)
    if (p.corrects_payment_id)
      corrected.set(p.corrects_payment_id, (corrected.get(p.corrects_payment_id) ?? 0) + p.amount_cents);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className={`font-mono text-3xl font-semibold ${cancelled ? "line-through" : ""}`}>{b.reference}</h1>
            <BookingStatusBadge status={b.status} />
          </div>
          <p className="text-muted-foreground mt-1">
            {formatDateLong(b.service_date)}
            {b.departure_time && ` · ${formatTime(b.departure_time)}`}
            {b.meeting_point && ` · ${b.meeting_point}`}
          </p>
          <p className="text-muted-foreground text-sm">
            Created by {name(b.created_by)} on {formatDateTime(b.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {b.tickets && !cancelled && (
            <Button asChild variant="outline">
              <Link href={`/tickets/${b.tickets.token}?print=1`}>
                <PrinterIcon /> Print ticket
                {b.tickets.printed_count > 0 && (
                  <span className="text-muted-foreground text-sm">({b.tickets.printed_count})</span>
                )}
              </Link>
            </Button>
          )}
          {canAmend && (
            <Button asChild variant="outline">
              <Link href={`/bookings/${b.id}/edit`}>
                <PencilIcon /> Amend
              </Link>
            </Button>
          )}
          {canAmend && <CancelBookingDialog bookingId={b.id} paid={cents(Math.max(0, paid))} />}
          {seesMoneyBehind && (
            <Button asChild variant="ghost">
              <Link href={`/bookings/${b.id}/history`}>View audit trail</Link>
            </Button>
          )}
        </div>
      </div>

      {cancelled && (
        <Alert variant="destructive" className="mb-6">
          Cancelled on {b.cancelled_at && formatDateTime(b.cancelled_at)} by {name(b.cancelled_by)}:{" "}
          {b.cancellation_reason}
        </Alert>
      )}
      {canWrite && !cancelled && user.role === "receptionist" && past && (
        <Alert className="mb-6">
          This booking&rsquo;s date has passed, so only an admin can amend or cancel it. That protects days whose cash
          is already counted. Payments can still be recorded or corrected.
        </Alert>
      )}
      {b.notes && <Alert className="mb-6 whitespace-pre-line">{b.notes}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Client</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {b.clients && (
              <Link href={`/clients/${b.clients.id}`} className="text-accent-foreground font-semibold hover:underline">
                {b.clients.first_name} {b.clients.last_name}
              </Link>
            )}
            <span>{formatPhone(b.clients?.phone_e164)}</span>
            <span>{b.clients?.email}</span>
            <span className="text-muted-foreground mt-2">{people.join(", ")}</span>
            {b.resources && (
              <Badge variant="info" className="mt-2 w-fit">
                Boat: {b.resources.name}
              </Badge>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Source</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {b.tour_operators ? (
              <>
                <div className="font-semibold">{b.tour_operators.name}</div>
                <PayerBanner operatorName={b.tour_operators.name} payer={b.payer as "client" | "operator"} />
                {b.payer === "operator" && (
                  <p>
                    Receivable from {b.tour_operators.name}:{" "}
                    <span className="font-semibold">{formatRs(cents(Math.max(0, due)))}</span>
                  </p>
                )}
              </>
            ) : (
              <div className="font-semibold">Walk-in</div>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="font-display mt-8 mb-3 text-xl font-semibold">Lines</h2>
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Participant</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Line total</TableHead>
              {seesMoneyBehind && <TableHead className="text-right">Operator net</TableHead>}
              {seesMoneyBehind && <TableHead className="text-right">Commission</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-semibold">{i.packages?.name ?? i.activities?.name}</TableCell>
                <TableCell>{TYPE[i.participant_type]}</TableCell>
                <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRs(cents(i.unit_charged_cents))}
                  {i.unit_retail_cents !== i.unit_charged_cents && seesMoneyBehind && (
                    <div className="text-muted-foreground text-sm">retail {formatRs(cents(i.unit_retail_cents))}</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRs(cents(i.unit_charged_cents * i.quantity))}
                </TableCell>
                {seesMoneyBehind && (
                  <TableCell className="text-right tabular-nums">
                    {i.unit_operator_net_cents === null ? "—" : formatRs(cents(i.unit_operator_net_cents * i.quantity))}
                  </TableCell>
                )}
                {seesMoneyBehind && (
                  <TableCell className="text-right tabular-nums">
                    {i.commission_cents
                      ? `${formatRs(cents(i.commission_cents))} (${formatRate(i.commission_rate)})`
                      : "—"}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            {b.discount_total_cents > 0 && (
              <>
                <TableRow>
                  <TableCell colSpan={4}>Subtotal</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRs(cents(subtotal))}</TableCell>
                  {seesMoneyBehind && <TableCell colSpan={2} />}
                </TableRow>
                <TableRow>
                  <TableCell colSpan={4}>Discount: {items.find((i) => i.discount_reason)?.discount_reason}</TableCell>
                  <TableCell className="text-destructive text-right tabular-nums">
                    −{formatRs(cents(b.discount_total_cents))}
                  </TableCell>
                  {seesMoneyBehind && <TableCell colSpan={2} />}
                </TableRow>
              </>
            )}
            <TableRow>
              <TableCell colSpan={4} className="font-semibold">
                Total charged
              </TableCell>
              <TableCell className="text-right text-lg font-semibold tabular-nums">
                {formatRs(cents(b.charged_total_cents))}
              </TableCell>
              {seesMoneyBehind && (
                <TableCell className="text-right tabular-nums">
                  {b.operator_net_total_cents ? formatRs(cents(b.operator_net_total_cents)) : "—"}
                </TableCell>
              )}
              {seesMoneyBehind && (
                <TableCell className="text-right tabular-nums">
                  {b.commission_total_cents ? formatRs(cents(b.commission_total_cents)) : "—"}
                </TableCell>
              )}
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-display mb-3 text-xl font-semibold">Entitlements</h2>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Activity</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...b.booking_activities]
                  .sort((x, y) => (x.activities?.sort_order ?? 0) - (y.activities?.sort_order ?? 0))
                  .map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.activities?.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.quantity}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">Redemption arrives in V2</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">Payments</h2>
            {canWrite && !cancelled && due > 0 && (
              <RecordPaymentDialog bookingId={b.id} due={cents(due)} payer={b.payer as "client" | "operator"} />
            )}
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>By</TableHead>
                  {canWrite && (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canWrite ? 5 : 4} className="text-muted-foreground">
                      {b.payer === "operator" ? "Nothing collected: the operator pays on account." : "No payments yet."}
                    </TableCell>
                  </TableRow>
                )}
                {payments.map((p) => {
                  const remaining = p.amount_cents + (corrected.get(p.id) ?? 0);
                  return (
                    <TableRow key={p.id} className={p.is_correction ? "bg-destructive-surface/50" : undefined}>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(p.received_at)}
                        {p.is_correction && <div className="text-sm">Correction: {p.note}</div>}
                        {p.reference && <div className="text-muted-foreground text-sm">Ref {p.reference}</div>}
                      </TableCell>
                      <TableCell>{METHOD[p.method]}</TableCell>
                      <TableCell className={`text-right tabular-nums ${p.amount_cents < 0 ? "text-destructive" : ""}`}>
                        {formatRs(cents(p.amount_cents))}
                      </TableCell>
                      <TableCell>{name(p.recorded_by)}</TableCell>
                      {canWrite && (
                        <TableCell>
                          {!p.is_correction && remaining > 0 && (
                            <CorrectPaymentDialog
                              paymentId={p.id}
                              amount={cents(remaining)}
                              label={`${formatRs(cents(p.amount_cents))} ${METHOD[p.method].toLowerCase()} on ${formatDateTime(p.received_at)}`}
                            />
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Paid</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRs(cents(paid))}</TableCell>
                  <TableCell colSpan={canWrite ? 2 : 1} />
                </TableRow>
                <TableRow>
                  <TableCell colSpan={2} className="font-semibold">
                    {due >= 0 ? "Balance due" : "Overpaid"}
                  </TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${due > 0 ? "text-warning" : ""}`}>
                    {formatRs(cents(Math.abs(due)))}
                  </TableCell>
                  <TableCell colSpan={canWrite ? 2 : 1} />
                </TableRow>
              </TableFooter>
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
