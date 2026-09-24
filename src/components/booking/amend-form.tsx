"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { amendBooking, bookingContext, type BookingContext } from "@/actions/bookings";
import { getQuote } from "@/actions/quotes";
import { BoatPicker, type Boat } from "@/components/booking/boat-picker";
import {
  PurchasePicker,
  partySize,
  purchaseLines,
  purchaseNeedsBoat,
  type Purchase,
  type WizardActivity,
  type WizardPackage,
} from "@/components/booking/purchase-picker";
import { QuotePanel } from "@/components/booking/quote-panel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRs, fromCents, type Cents } from "@/lib/money";
import type { Quote } from "@/lib/pricing/types";

export type AmendableBooking = {
  id: string;
  reference: string;
  service_date: string;
  operator_id: string | null;
  departure_time: string;
  meeting_point: string;
  notes: string;
  resource_id: string | null;
  charged_total: Cents;
  paid: Cents;
  payer: "client" | "operator";
  discount_total: Cents;
  discount_reason: string;
  people: number;
};

/** Amend lines, participants, time, place, notes, boat and discount; re-quoted live. */
export function AmendForm({
  booking,
  initial,
  packages,
  activities,
  boats,
}: {
  booking: AmendableBooking;
  initial: Purchase;
  packages: WizardPackage[];
  activities: WizardActivity[];
  boats: Boat[];
}) {
  const router = useRouter();
  const [purchase, setPurchase] = useState(initial);
  const [departureTime, setDepartureTime] = useState(booking.departure_time);
  const [meetingPoint, setMeetingPoint] = useState(booking.meeting_point);
  const [notes, setNotes] = useState(booking.notes);
  const [boatId, setBoatId] = useState(booking.resource_id);
  const [discount, setDiscount] = useState({
    type: "amount" as "amount" | "percent",
    value: booking.discount_total > 0 ? String(fromCents(booking.discount_total)) : "",
    reason: booking.discount_reason,
  });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [requote, setRequote] = useState(0);
  const [context, setContext] = useState<BookingContext>({ tilePrices: {}, fleetLoad: {} });
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const call = useRef(0);

  const lines = useMemo(() => purchaseLines(purchase), [purchase]);
  const needsBoat = purchaseNeedsBoat(purchase, packages, activities);
  const discountActive = discount.value.trim() !== "";

  useEffect(() => {
    if (lines.length === 0) return;
    const n = ++call.current;
    setStale(true);
    const timer = setTimeout(async () => {
      const r = await getQuote({
        service_date: booking.service_date,
        operator_id: booking.operator_id,
        lines,
        discount: discountActive ? discount : null,
      });
      if (n !== call.current) return;
      setStale(false);
      if (r.ok) {
        setQuote(r.data);
        setQuoteError(null);
      } else setQuoteError(r.error);
    }, 150);
    return () => clearTimeout(timer);
  }, [lines, discount, discountActive, booking.service_date, booking.operator_id, requote]);

  useEffect(() => {
    bookingContext({ service_date: booking.service_date, operator_id: booking.operator_id }).then((r) => {
      if (!r.ok) return;
      // This booking's own people are already in its boat's load.
      const load = { ...r.data.fleetLoad };
      if (booking.resource_id)
        load[booking.resource_id] = Math.max(0, (load[booking.resource_id] ?? 0) - booking.people);
      setContext({ ...r.data, fleetLoad: load });
    });
  }, [booking.service_date, booking.operator_id, booking.resource_id, booking.people]);

  const total = quote && !quoteError ? quote.charged_total_cents : null;
  const blocker =
    lines.length === 0
      ? "Choose a package or activity, and at least one participant."
      : (quoteError ??
        (!quote || stale ? "Working out the price…" : null) ??
        (discountActive && !discount.reason.trim() ? "Give a reason for the discount." : null) ??
        (needsBoat && !boatId ? "Pick a boat: this booking includes the catamaran." : null));

  function save() {
    if (blocker || total === null) return;
    setError(null);
    startSaving(async () => {
      const r = await amendBooking({
        booking_id: booking.id,
        lines,
        participants: purchase.participants,
        discount: discountActive ? discount : null,
        departure_time: departureTime,
        meeting_point: meetingPoint,
        notes,
        resource_id: needsBoat ? boatId : null,
        expected_total_cents: total,
      });
      if (!r.ok) {
        setError(r.error);
        if (/Prices changed/.test(r.error)) setRequote((x) => x + 1);
        return;
      }
      toast.success(`Saved. Total was ${formatRs(r.data.previous)}, now ${formatRs(r.data.total)}.`);
      router.push(`/bookings/${booking.id}`);
    });
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save();
        } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <PurchasePicker
              packages={packages}
              activities={activities}
              tilePrices={context.tilePrices}
              value={purchase}
              onChange={setPurchase}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="departure_time">Departure time</Label>
                <Input
                  id="departure_time"
                  type="time"
                  value={departureTime}
                  onChange={(e) => setDepartureTime(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="meeting_point">Meeting point</Label>
                <Input id="meeting_point" value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>
        {needsBoat && (
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <h2 className="font-display text-lg font-semibold">Boat</h2>
              <BoatPicker
                boats={boats}
                load={context.fleetLoad}
                partySize={partySize(purchase.participants)}
                value={boatId}
                onChange={setBoatId}
              />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-[auto_1fr_2fr]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="discount_type">Discount</Label>
              <select
                id="discount_type"
                className="border-input bg-card min-h-11 rounded-md border px-3"
                value={discount.type}
                onChange={(e) => setDiscount((d) => ({ ...d, type: e.target.value as "percent" | "amount" }))}
              >
                <option value="amount">Rs</option>
                <option value="percent">%</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="discount_value">{discount.type === "percent" ? "Percent" : "Amount"}</Label>
              <Input
                id="discount_value"
                inputMode="decimal"
                value={discount.value}
                onChange={(e) => setDiscount((d) => ({ ...d, value: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="discount_reason">Reason</Label>
              <Input
                id="discount_reason"
                value={discount.reason}
                onChange={(e) => setDiscount((d) => ({ ...d, reason: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>
      </div>
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <h2 className="font-display text-lg font-semibold">New quote</h2>
            <QuotePanel quote={quote} error={quoteError} stale={stale} empty={lines.length === 0} changeDue={null} />
            {total !== null && (
              <Alert data-testid="before-after">
                Total was {formatRs(booking.charged_total)}, now {formatRs(total)}.{" "}
                {booking.payer === "operator"
                  ? `Receivable from the operator: ${formatRs(total)}.`
                  : total >= booking.paid
                    ? `Balance due ${formatRs((total - booking.paid) as Cents)}.`
                    : `That is ${formatRs((booking.paid - total) as Cents)} less than already paid: record a refund first.`}
              </Alert>
            )}
            {error && <Alert variant="destructive">{error}</Alert>}
            {blocker && !quoteError && <p className="text-muted-foreground text-sm">{blocker}</p>}
            <Button type="submit" size="lg" disabled={!!blocker || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push(`/bookings/${booking.id}`)}>
              Back without saving
            </Button>
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}
