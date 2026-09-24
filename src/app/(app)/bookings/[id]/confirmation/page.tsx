import { CircleCheckBigIcon, MailIcon, MessageCircleIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PayerBanner } from "@/components/shared/payer-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { formatDateLong, formatTime } from "@/lib/dates";
import { cents, formatRs } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Booking created · AquaSail Ops" };

/** Shown straight after a booking is created (WP-15/16). "New booking" is first, for the next customer. */
export default async function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "receptionist"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "id, reference, service_date, departure_time, charged_total_cents, payer, clients(first_name, last_name), tour_operators(name), payments(amount_cents), tickets(token)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!b) notFound();
  const paid = b.payments.reduce((sum, p) => sum + p.amount_cents, 0);
  const due = b.charged_total_cents - paid;

  return (
    <Card className="mx-auto max-w-2xl">
      <CardContent className="flex flex-col items-center gap-5 pt-8 text-center">
        <CircleCheckBigIcon className="text-success size-14" aria-hidden />
        <div>
          <h1 className="font-display text-2xl font-semibold">Booking created</h1>
          <p className="text-muted-foreground">
            {b.clients?.first_name} {b.clients?.last_name} · {formatDateLong(b.service_date)}
            {b.departure_time && ` · ${formatTime(b.departure_time)}`}
          </p>
        </div>
        <div className="font-mono text-4xl font-semibold tracking-wide" data-testid="booking-reference">
          {b.reference}
        </div>
        <div className="text-lg">
          Total <span className="font-semibold">{formatRs(cents(b.charged_total_cents))}</span>
          {b.payer === "client" && (
            <>
              {" · "}
              {due <= 0 ? (
                <span className="text-success font-semibold">Paid</span>
              ) : (
                <span className="text-warning font-semibold">Balance due {formatRs(cents(due))}</span>
              )}
            </>
          )}
        </div>
        {b.payer === "operator" && b.tour_operators && (
          <PayerBanner operatorName={b.tour_operators.name} payer="operator" />
        )}
        <div className="flex w-full flex-wrap justify-center gap-3">
          <Button asChild size="lg" autoFocus>
            <Link href="/bookings/new">
              <PlusIcon /> New booking
            </Link>
          </Button>
          {b.tickets && (
            <Button asChild size="lg" variant="outline">
              <Link href={`/tickets/${b.tickets.token}`}>Print ticket</Link>
            </Button>
          )}
          <Button asChild size="lg" variant="outline">
            <Link href={`/bookings/${b.id}`}>View booking</Link>
          </Button>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" variant="ghost" disabled title="Available in V2">
            <MessageCircleIcon /> Send WhatsApp <span className="text-xs">(V2)</span>
          </Button>
          <Button type="button" variant="ghost" disabled title="Available in V2">
            <MailIcon /> Send email <span className="text-xs">(V2)</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
