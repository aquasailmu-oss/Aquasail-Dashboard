"use client";

import { UserCheckIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { bookingContext, createBooking, type BookingContext } from "@/actions/bookings";
import { findSimilarClients, type ClientMatch } from "@/actions/clients";
import { getQuote } from "@/actions/quotes";
import { BoatPicker, type Boat } from "@/components/booking/boat-picker";
import { QuotePanel } from "@/components/booking/quote-panel";
import {
  PurchasePicker,
  partySize,
  purchaseLines,
  purchaseNeedsBoat,
  type Purchase,
  type WizardActivity,
  type WizardPackage,
} from "@/components/booking/purchase-picker";
import { ClientMatchBanner } from "@/components/clients/client-match-banner";
import { PayerBanner } from "@/components/shared/payer-banner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateShort } from "@/lib/dates";
import { cents, formatRs, fromCents, toCents, type Cents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import type { Quote } from "@/lib/pricing/types";
import { openAfterSave } from "@/lib/navigate";
import { cn } from "@/lib/utils";

type WizardOperator = { id: string; name: string; payer: "client" | "operator" };

type PaymentMethod = "cash" | "card" | "bank_transfer" | "other";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

/** Number keys pick packages unless the user is typing into a field. */
function isTyping(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !["radio", "checkbox", "button", "submit"].includes((el as HTMLInputElement).type);
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <h2 className="font-display flex items-center gap-3 text-lg font-semibold">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-full text-sm">
            {n}
          </span>
          {title}
        </h2>
        {children}
      </CardContent>
    </Card>
  );
}

function tryCents(value: string): Cents | null {
  try {
    return value.trim() ? toCents(value) : null;
  } catch {
    return null;
  }
}

/**
 * The booking form (WP-15): one page, four or five sections, a live quote.
 * Keyboard first: focus starts in First name, tab order follows the page,
 * 1–9 pick a package tile, Ctrl/Cmd+Enter submits. Prices come from the
 * engine; this component never computes one.
 */
export function BookingWizard({
  packages,
  activities,
  operators,
  boats,
  defaultMeetingPoint,
  today,
}: {
  packages: WizardPackage[];
  activities: WizardActivity[];
  operators: WizardOperator[];
  boats: Boat[];
  defaultMeetingPoint: string;
  today: string;
}) {
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  // 1. Client
  const [client, setClient] = useState({ first_name: "", last_name: "", phone: "", email: "", country: "" });
  const [chosenClient, setChosenClient] = useState<ClientMatch | null>(null);
  const [matches, setMatches] = useState<ClientMatch[]>([]);
  // 2. Source
  const [operatorId, setOperatorId] = useState<string | null>(null);
  // 3. What they bought
  const [purchase, setPurchase] = useState<Purchase>({
    packageIds: [],
    activityIds: [],
    participants: { adult: 1, child: 0, infant: 0 },
  });
  const [serviceDate, setServiceDate] = useState(today);
  const [departureTime, setDepartureTime] = useState("");
  const [meetingPoint, setMeetingPoint] = useState(defaultMeetingPoint);
  const [notes, setNotes] = useState("");
  // 4. Boat
  const [boatId, setBoatId] = useState<string | null>(null);
  // 5. Payment
  const [discount, setDiscount] = useState({ type: "percent" as "percent" | "amount", value: "", reason: "" });
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [received, setReceived] = useState("");
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteStale, setQuoteStale] = useState(false);
  const [requote, setRequote] = useState(0);
  const [context, setContext] = useState<BookingContext>({ tilePrices: {}, fleetLoad: {} });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const quoteCall = useRef(0);
  const matchCall = useRef(0);

  const operator = operators.find((o) => o.id === operatorId) ?? null;
  const size = partySize(purchase.participants);
  const lines = useMemo(() => purchaseLines(purchase), [purchase]);
  const needsBoat = purchaseNeedsBoat(purchase, packages, activities);
  const discountActive = discount.value.trim() !== "";

  // Quote: re-priced on every change, keeping the last one on screen meanwhile.
  useEffect(() => {
    if (lines.length === 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const call = ++quoteCall.current;
    setQuoteStale(true);
    const timer = setTimeout(async () => {
      const result = await getQuote({
        service_date: serviceDate,
        operator_id: operatorId,
        lines,
        discount: discountActive ? discount : null,
      });
      if (call !== quoteCall.current) return;
      setQuoteStale(false);
      if (result.ok) {
        setQuote(result.data);
        setQuoteError(null);
      } else {
        setQuoteError(result.error);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [lines, serviceDate, operatorId, discount, discountActive, requote]);

  // Tile prices and boat loads for the date and source.
  useEffect(() => {
    let live = true;
    bookingContext({ service_date: serviceDate, operator_id: operatorId }).then((r) => {
      if (live && r.ok) setContext(r.data);
    });
    return () => {
      live = false;
    };
  }, [serviceDate, operatorId]);

  // Existing customer lookup while typing.
  useEffect(() => {
    if (chosenClient) return;
    const { first_name, last_name, phone, email } = client;
    if (!phone && !email && first_name.length + last_name.length < 4) {
      setMatches([]);
      return;
    }
    const call = ++matchCall.current;
    const timer = setTimeout(async () => {
      const found = await findSimilarClients({ first_name, last_name, phone, email });
      if (call === matchCall.current) setMatches(found.ok ? found.data : []);
    }, 300);
    return () => clearTimeout(timer);
  }, [client, chosenClient]);

  // Amount received is the total until reception types their own. Derived,
  // not copied in an effect, so an instant Ctrl+Enter still records payment.
  const total = quote && !quoteError ? quote.charged_total_cents : null;
  const receivedValue = receivedTouched ? received : total !== null ? String(fromCents(total)) : "";

  const receivedCents = tryCents(receivedValue);
  const changeDue =
    method === "cash" && receivedCents !== null && total !== null && receivedCents > total
      ? cents(receivedCents - total)
      : null;
  const payerIsOperator = operator?.payer === "operator";

  const togglePackage = useCallback(
    (id: string) =>
      setPurchase((p) => ({
        ...p,
        packageIds: p.packageIds.includes(id) ? p.packageIds.filter((x) => x !== id) : [...p.packageIds, id],
      })),
    [],
  );

  const blocker = (() => {
    if (!chosenClient && !client.first_name.trim()) return "Enter the client's first name.";
    if (lines.length === 0) return size === 0 ? "Add at least one participant." : "Choose a package or activity.";
    if (quoteError) return quoteError;
    if (!quote || quoteStale) return "Working out the price…";
    if (discountActive && !discount.reason.trim()) return "Give a reason for the discount.";
    if (needsBoat && !boatId) return "Pick a boat: this booking includes the catamaran.";
    return null;
  })();

  const submit = useCallback(() => {
    if (blocker || !quote || submitting) return;
    setSubmitError(null);
    startSubmit(async () => {
      const result = await createBooking({
        idempotency_key: idempotencyKey.current,
        client_id: chosenClient?.id ?? null,
        client,
        service_date: serviceDate,
        operator_id: operatorId,
        lines,
        participants: purchase.participants,
        discount: discountActive ? discount : null,
        departure_time: departureTime,
        meeting_point: meetingPoint,
        notes,
        resource_id: needsBoat ? boatId : null,
        payment: payerIsOperator ? null : { method, received: receivedValue, reference: paymentRef },
        expected_total_cents: quote.charged_total_cents,
      });
      if (result.ok) return openAfterSave(`/bookings/${result.data.id}/confirmation`);
      setSubmitError(result.error);
      if (/Prices changed/.test(result.error)) setRequote((n) => n + 1); // show the new price
    });
  }, [
    blocker,
    quote,
    submitting,
    chosenClient,
    client,
    serviceDate,
    operatorId,
    lines,
    purchase.participants,
    discountActive,
    discount,
    departureTime,
    meetingPoint,
    notes,
    needsBoat,
    boatId,
    payerIsOperator,
    method,
    receivedValue,
    paymentRef,
  ]);

  // Keyboard: Ctrl/Cmd+Enter submits anywhere; 1–9 pick a package tile when not typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
        return;
      }
      if (isTyping(e.target as Element | null)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= 9 && packages[n - 1]) {
        e.preventDefault();
        togglePackage(packages[n - 1].id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, packages, togglePackage]);

  const setField = (name: keyof typeof client) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setClient((c) => ({ ...c, [name]: e.target.value }));

  return (
    <form
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        // Plain Enter in a field must not create a booking; Ctrl/Cmd+Enter does.
        if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
        }
      }}
    >
      <div className="flex min-w-0 flex-col gap-6">
        {/* 1. CLIENT */}
        <Section n={1} title="Client">
          {chosenClient ? (
            <div className="bg-success-surface flex flex-wrap items-center justify-between gap-3 rounded-md px-4 py-3">
              <div className="flex items-center gap-2">
                <UserCheckIcon className="text-success size-5" aria-hidden />
                <span className="font-semibold">
                  {chosenClient.first_name} {chosenClient.last_name}
                </span>
                <span className="text-muted-foreground text-sm">
                  {[formatPhone(chosenClient.phone_e164), chosenClient.email].filter(Boolean).join(" · ")} ·{" "}
                  {chosenClient.booking_count} previous booking{chosenClient.booking_count === 1 ? "" : "s"}
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setChosenClient(null)}>
                Change client
              </Button>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="first_name">First name</Label>
                  <Input
                    id="first_name"
                    autoFocus
                    autoComplete="off"
                    value={client.first_name}
                    onChange={setField("first_name")}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="last_name">Last name</Label>
                  <Input id="last_name" autoComplete="off" value={client.last_name} onChange={setField("last_name")} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="phone">
                    Phone <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    autoComplete="off"
                    placeholder="5700 1234"
                    value={client.phone}
                    onChange={setField("phone")}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">
                    Email <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input id="email" type="email" autoComplete="off" value={client.email} onChange={setField("email")} />
                </div>
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <Label htmlFor="country">
                    Country <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input id="country" autoComplete="off" value={client.country} onChange={setField("country")} />
                </div>
              </div>
              <ClientMatchBanner
                matches={matches}
                onUse={(m) => {
                  setChosenClient(m);
                  setMatches([]);
                }}
              />
            </>
          )}
        </Section>

        {/* 2. SOURCE */}
        <Section n={2} title="Source">
          <fieldset className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <legend className="sr-only">Booking source</legend>
            {[{ id: null, name: "Walk-in", payer: "client" as const }, ...operators].map((o) => {
              const selected = operatorId === o.id;
              return (
                <label
                  key={o.id ?? "walk_in"}
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center gap-3 rounded-md border-2 px-3 py-2",
                    selected ? "border-primary bg-accent" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="source"
                    checked={selected}
                    onChange={() => setOperatorId(o.id)}
                    className="accent-primary size-5 shrink-0"
                  />
                  <span>
                    <span className="block font-semibold">{o.name}</span>
                    {o.id && (
                      <span
                        className={cn(
                          "text-sm",
                          o.payer === "operator" ? "text-destructive font-semibold" : "text-muted-foreground",
                        )}
                      >
                        {o.payer === "operator" ? "Operator pays" : "Customer pays"}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {operator && <PayerBanner operatorName={operator.name} payer={operator.payer} />}
        </Section>

        {/* 3. WHAT THEY BOUGHT */}
        <Section n={3} title="What they bought">
          <PurchasePicker
            packages={packages}
            activities={activities}
            tilePrices={context.tilePrices}
            value={purchase}
            onChange={setPurchase}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="service_date">Service date</Label>
              <Input
                id="service_date"
                type="date"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value || today)}
              />
            </div>
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
          {serviceDate < today && (
            <Alert variant="warning">
              Backdated entry: {formatDateShort(serviceDate)} is in the past. The booking is marked as entered after the
              event, at that date&rsquo;s prices.
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </Section>

        {/* 4. BOAT (only when the catamaran is included) */}
        {needsBoat && (
          <Section n={4} title="Assign a boat">
            <p className="text-muted-foreground">
              This booking includes the catamaran. Pick the vessel that carries the group.
            </p>
            <BoatPicker boats={boats} load={context.fleetLoad} partySize={size} value={boatId} onChange={setBoatId} />
          </Section>
        )}

        {/* 5. PAYMENT */}
        <Section n={needsBoat ? 5 : 4} title="Payment">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr_2fr]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="discount_type">Discount</Label>
              <select
                id="discount_type"
                className="border-input bg-card min-h-11 rounded-md border px-3"
                value={discount.type}
                onChange={(e) => setDiscount((d) => ({ ...d, type: e.target.value as "percent" | "amount" }))}
              >
                <option value="percent">%</option>
                <option value="amount">Rs</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="discount_value">{discount.type === "percent" ? "Percent" : "Amount"}</Label>
              <Input
                id="discount_value"
                inputMode="decimal"
                placeholder="0"
                value={discount.value}
                onChange={(e) => setDiscount((d) => ({ ...d, value: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="discount_reason">
                Reason {discountActive && <span className="text-destructive">(required)</span>}
              </Label>
              <Input
                id="discount_reason"
                value={discount.reason}
                aria-invalid={discountActive && !discount.reason.trim()}
                onChange={(e) => setDiscount((d) => ({ ...d, reason: e.target.value }))}
              />
            </div>
          </div>

          {payerIsOperator && operator ? (
            <div className="flex flex-col gap-3">
              <PayerBanner operatorName={operator.name} payer="operator" />
              <p>
                Nothing is collected here. {total !== null ? formatRs(total) : "The total"} becomes a receivable from{" "}
                {operator.name}.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="method">Payment method</Label>
                <select
                  id="method"
                  className="border-input bg-card min-h-11 rounded-md border px-3"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="received">Amount received (Rs)</Label>
                <Input
                  id="received"
                  inputMode="decimal"
                  value={receivedValue}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    setReceivedTouched(true);
                    setReceived(e.target.value);
                  }}
                />
                <p className="text-muted-foreground text-sm">Leave empty if nothing is paid yet.</p>
              </div>
              {method !== "cash" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="payment_ref">Reference</Label>
                  <Input
                    id="payment_ref"
                    placeholder="Card slip or transfer no."
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* QUOTE */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <h2 className="font-display text-lg font-semibold">Quote</h2>
            <QuotePanel
              quote={quote}
              error={quoteError}
              stale={quoteStale}
              empty={lines.length === 0}
              changeDue={changeDue}
            />
            {submitError && <Alert variant="destructive">{submitError}</Alert>}
            {blocker && !quoteError && lines.length > 0 && <p className="text-muted-foreground text-sm">{blocker}</p>}
            <Button type="submit" size="lg" disabled={!!blocker || submitting} className="w-full">
              {submitting ? "Creating…" : "Create booking"}
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              <kbd className="bg-secondary rounded px-1.5">Ctrl</kbd> +{" "}
              <kbd className="bg-secondary rounded px-1.5">Enter</kbd> to submit · number keys pick a package
            </p>
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}
