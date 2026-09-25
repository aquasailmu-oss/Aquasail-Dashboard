import { PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatusBadge } from "@/components/shared/booking-status-badge";
import { PayerBanner } from "@/components/shared/payer-banner";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { businessDate, formatDateShort } from "@/lib/dates";
import { cents, formatRs } from "@/lib/money";
import { SETTLEMENT_MODELS, formatRate, type Payer, type SettlementModel } from "@/lib/operators";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Operator · AquaSail Ops" };

const PARTICIPANT = { adult: "Adult", child: "Child", infant: "Infant" } as const;

export default async function OperatorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  const today = businessDate();
  const supabase = await createClient();
  const [{ data: o }, { data: prices }, { data: bookings }] = await Promise.all([
    supabase.from("tour_operators").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("price_rules")
      .select(
        "id, participant_type, retail_cents, net_cents, commission_rate, effective_from, effective_to, activities(name), packages(name)",
      )
      .eq("operator_id", id)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gt.${today}`)
      .order("participant_type"),
    supabase
      .from("bookings")
      .select("id, reference, service_date, status, charged_total_cents, clients(first_name, last_name)")
      .eq("operator_id", id)
      .order("service_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (!o) notFound();
  const model = SETTLEMENT_MODELS[o.settlement_model as SettlementModel];

  return (
    <>
      <PageHeader
        title={o.name}
        description={`${o.code}${o.is_active ? "" : " · deactivated"}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/operators/${o.id}/edit`}>
              <PencilIcon />
              Edit
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>How they are settled</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <div className="font-semibold">
                {model.label}
                {o.settlement_model === "commission" && ` at ${formatRate(o.default_commission_rate)}`}
              </div>
              <p className="text-muted-foreground text-sm">{model.explanation}</p>
            </div>
            <PayerBanner operatorName={o.name} payer={o.payer as Payer} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <div className="font-semibold">{o.contact_name ?? "—"}</div>
            <div>{formatPhone(o.contact_phone)}</div>
            <div>{o.contact_email}</div>
            {o.notes && <p className="text-muted-foreground mt-3 whitespace-pre-line">{o.notes}</p>}
          </CardContent>
        </Card>
      </div>

      <h2 className="font-display mt-8 mb-1 text-xl font-semibold">Prices for {o.name} today</h2>
      <p className="text-muted-foreground mb-3 text-sm">
        Only prices set specifically for this operator. Anything not listed is charged at the walk-in price.{" "}
        <Link href="/admin/pricing" className="text-accent-foreground font-semibold underline">
          Open Pricing
        </Link>
      </p>
      {!prices?.length ? (
        <Card className="text-muted-foreground p-8 text-center">No operator-specific prices.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Participant</TableHead>
                <TableHead className="text-right">Retail</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead>Until</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prices.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-semibold">{p.packages?.name ?? p.activities?.name}</TableCell>
                  <TableCell>{PARTICIPANT[p.participant_type]}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRs(cents(p.retail_cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.net_cents === null ? "—" : formatRs(cents(p.net_cents))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.commission_rate === null ? "—" : formatRate(p.commission_rate)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {p.effective_to ? formatDateShort(p.effective_to) : "Open-ended"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <h2 className="font-display mt-8 mb-3 text-xl font-semibold">Recent bookings</h2>
      {!bookings?.length ? (
        <Card className="text-muted-foreground p-8 text-center">No bookings through {o.name} yet.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Charged</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow
                  key={b.id}
                  className={b.status === "cancelled" ? "text-muted-foreground line-through" : undefined}
                >
                  <TableCell className="font-mono whitespace-nowrap">{b.reference}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateShort(b.service_date)}</TableCell>
                  <TableCell>
                    {b.clients?.first_name} {b.clients?.last_name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatRs(cents(b.charged_total_cents))}</TableCell>
                  <TableCell>
                    <BookingStatusBadge status={b.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
