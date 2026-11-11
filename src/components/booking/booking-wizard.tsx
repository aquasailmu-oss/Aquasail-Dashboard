"use client";

import { UserCheckIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { bookingContext, createBooking, type BookingContext } from "@/actions/bookings";
import { findSimilarClients, type ClientMatch } from "@/actions/clients";
import { getQuote } from "@/actions/quotes";
import { BoatPicker, type Boat } from "@/components/booking/boat-picker";
import { QuotePanel } from "@/components/booking/quote-panel";
import { PurchasePicker } from "@/components/booking/purchase-picker";
import { Stepper } from "@/components/booking/stepper";
import { WaiverManager } from "@/components/waivers/waiver-manager";
import {
  partySize,
  minimumPartySize,
  purchaseLines,
  purchaseNeedsBoat,
  type Purchase,
  type WizardActivity,
  type WizardPackage,
} from "@/components/booking/purchase-utils";
import { ClientMatchBanner } from "@/components/clients/client-match-banner";
import { PayerBanner } from "@/components/shared/payer-banner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateShort } from "@/lib/dates";
import { unitsForParticipants } from "@/lib/activity-units";
import { cents, formatRs, fromCents, toCents, type Cents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import type { Quote } from "@/lib/pricing/types";
import { cn } from "@/lib/utils";

type WizardOperator = { id: string; name: string; payer: "client" | "operator"; logoUrl: string | null };
type PreRegistration = {
  id: string;
  idempotencyKey: string;
  serviceDate: string;
  notes: string | null;
  hotelName: string | null;
  expectedPax: { adult: number; child: number; infant: number } | null;
  client: ClientMatch;
};

type PaymentMethod = "cash" | "card" | "bank_transfer" | "other";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

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
 * Inputs follow the booking flow from client through payment. Prices come
 * from the pricing engine; this component never computes one.
 */
export function BookingWizard({
  packages,
  activities,
  operators,
  initialOperatorId,
  boats,
  defaultMeetingPoint,
  today,
  preRegistration,
}: {
  packages: WizardPackage[];
  activities: WizardActivity[];
  operators: WizardOperator[];
  initialOperatorId: string;
  boats: Boat[];
  defaultMeetingPoint: string;
  today: string;
  preRegistration?: PreRegistration;
}) {
  const idempotencyKey = useRef<string>(preRegistration?.idempotencyKey ?? crypto.randomUUID());

  // 1. Client
  const [client, setClient] = useState({
    first_name: preRegistration?.client.first_name ?? "",
    last_name: preRegistration?.client.last_name ?? "",
    phone: preRegistration?.client.phone_e164 ?? "",
    email: preRegistration?.client.email ?? "",
    country: preRegistration?.client.country ?? "",
  });
  const [chosenClient, setChosenClient] = useState<ClientMatch | null>(preRegistration?.client ?? null);
  const [matches, setMatches] = useState<ClientMatch[]>([]);
  // 2. Source
  const [operatorId, setOperatorId] = useState(initialOperatorId);
  const [changingOperator, setChangingOperator] = useState(false);
  const [hotelName, setHotelName] = useState(preRegistration?.hotelName ?? "");
  // 3. Visit, guests and activities
  const [purchase, setPurchase] = useState<Purchase>({
    packageIds: [],
    activityIds: [],
    packageParticipants: {},
    activityParticipants: {},
    participants:
      preRegistration?.expectedPax ??
      (preRegistration ? { adult: 0, child: 0, infant: 0 } : { adult: 1, child: 0, infant: 0 }),
  });
  const [attendancePresent, setAttendancePresent] = useState(
    preRegistration?.expectedPax ??
      (preRegistration ? { adult: 0, child: 0, infant: 0 } : { adult: 1, child: 0, infant: 0 }),
  );
  const [attendanceTouched, setAttendanceTouched] = useState({ adult: false, child: false, infant: false });
  const [legacyExpectedPaxConfirmed, setLegacyExpectedPaxConfirmed] = useState(
    !preRegistration || preRegistration.expectedPax !== null,
  );
  const [serviceDate, setServiceDate] = useState(preRegistration?.serviceDate ?? today);
  const [departureTime, setDepartureTime] = useState("");
  const [meetingPoint, setMeetingPoint] = useState(defaultMeetingPoint);
  const [notes, setNotes] = useState(preRegistration?.notes ?? "");
  // 4. Boat
  const [boatId, setBoatId] = useState<string | null>(null);
  // 5. Payment
  const [discount, setDiscount] = useState({ type: "percent" as "percent" | "amount", value: "", reason: "" });
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [received, setReceived] = useState("");
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");
  const [prebookReduction, setPrebookReduction] = useState("");
  const [prebookReductionReason, setPrebookReductionReason] = useState("");
  const [savedBookingId, setSavedBookingId] = useState<string | null>(null);

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
  const requiredPartySize = minimumPartySize(purchase, packages);
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
  const absent = {
    adult: purchase.participants.adult - attendancePresent.adult,
    child: purchase.participants.child - attendancePresent.child,
    infant: purchase.participants.infant - attendancePresent.infant,
  };
  const totalAbsent = absent.adult + absent.child + absent.infant;
  const totalPresent = attendancePresent.adult + attendancePresent.child + attendancePresent.infant;
  const reductionValue = tryCents(prebookReduction);
  const productWithoutQuantity =
    purchase.packageIds
      .map((id) => ({
        name: packages.find((item) => item.id === id)?.name ?? "Selected package",
        quantity:
          (purchase.packageParticipants[id]?.adult ?? 0) +
          (purchase.packageParticipants[id]?.child ?? 0) +
          (purchase.packageParticipants[id]?.infant ?? 0),
      }))
      .find((item) => item.quantity === 0) ??
    purchase.activityIds
      .map((id) => ({
        name: activities.find((item) => item.id === id)?.name ?? "Selected activity",
        quantity:
          (purchase.activityParticipants[id]?.adult ?? 0) +
          (purchase.activityParticipants[id]?.child ?? 0) +
          (purchase.activityParticipants[id]?.infant ?? 0),
      }))
      .find((item) => item.quantity === 0);
  const updatePurchase = useCallback(
    (next: Purchase) => {
      const guestCountChanged =
        next.participants.adult !== purchase.participants.adult ||
        next.participants.child !== purchase.participants.child ||
        next.participants.infant !== purchase.participants.infant;
      if (preRegistration?.expectedPax === null && guestCountChanged) {
        setLegacyExpectedPaxConfirmed(false);
      }
      setPurchase(next);
      const nextAttendancePresent = {
        adult: attendanceTouched.adult
          ? Math.min(attendancePresent.adult, next.participants.adult)
          : next.participants.adult,
        child: attendanceTouched.child
          ? Math.min(attendancePresent.child, next.participants.child)
          : next.participants.child,
        infant: attendanceTouched.infant
          ? Math.min(attendancePresent.infant, next.participants.infant)
          : next.participants.infant,
      };
      setAttendancePresent(nextAttendancePresent);
      if (partySize(next.participants) === partySize(nextAttendancePresent)) {
        setPrebookReduction("");
        setPrebookReductionReason("");
      }
    },
    [attendancePresent, attendanceTouched, preRegistration?.expectedPax, purchase.participants],
  );

  const updatePresentCount = (key: keyof typeof attendancePresent, count: number) => {
    setAttendanceTouched((touched) => ({ ...touched, [key]: true }));
    const nextPresent = {
      ...attendancePresent,
      [key]: Math.min(count, purchase.participants[key]),
    };
    setAttendancePresent(nextPresent);
    if (partySize(purchase.participants) === partySize(nextPresent)) {
      setPrebookReduction("");
      setPrebookReductionReason("");
    }
  };

  const blocker = (() => {
    if (!chosenClient && !client.first_name.trim()) return "Enter the client's first name.";
    if (!operatorId) return "Choose a tour operator before creating the booking.";
    if (preRegistration?.expectedPax === null && !legacyExpectedPaxConfirmed) {
      return "Confirm the expected guest count for this older pre-registration.";
    }
    if (size === 0) return "Add at least one person to the booking.";
    if (size < requiredPartySize) {
      return (
        "Selected items need at least " +
        requiredPartySize +
        " guests, but " +
        size +
        " are expected. Increase the expected count above or reduce item quantities."
      );
    }
    if (payerIsOperator && prebookReduction.trim() && (reductionValue === null || reductionValue < 0)) {
      return "Enter a non-negative operator balance reduction with no more than two decimal places.";
    }
    if (payerIsOperator && reductionValue !== null && reductionValue > 0 && totalAbsent === 0) {
      return "A balance reduction can only be entered when someone did not attend.";
    }
    if (payerIsOperator && reductionValue !== null && reductionValue > 0 && !prebookReductionReason.trim()) {
      return "Add a short reason for the balance reduction.";
    }
    if (
      payerIsOperator &&
      reductionValue !== null &&
      quote?.operator_net_total_cents != null &&
      reductionValue > quote.operator_net_total_cents
    ) {
      return "The reduction cannot be greater than the amount the operator owes AquaSail.";
    }
    if (productWithoutQuantity) {
      return `Set the guest count or package units for ${productWithoutQuantity.name}.`;
    }
    if (lines.length === 0) return "Choose a package or activity and set its guest count.";
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
        pre_registration_id: preRegistration?.id ?? null,
        client_id: chosenClient?.id ?? null,
        client,
        service_date: serviceDate,
        operator_id: operatorId,
        hotel_name: hotelName,
        attendance: {
          adults_present: attendancePresent.adult,
          children_present: attendancePresent.child,
          infants_present: attendancePresent.infant,
          prebook_reduction: prebookReduction,
          prebook_reduction_reason: prebookReductionReason,
        },
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
      if (result.ok) {
        setSavedBookingId(result.data.id);
        return;
      }
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
    hotelName,
    attendancePresent,
    prebookReduction,
    prebookReductionReason,
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
    preRegistration?.id,
  ]);

  const setField = (name: keyof typeof client) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setClient((c) => ({ ...c, [name]: e.target.value }));
  };

  const selectedProductSummary = [
    ...purchase.packageIds.map((id) => {
      const pkg = packages.find((item) => item.id === id);
      const counts = purchase.packageParticipants[id] ?? { adult: 0, child: 0, infant: 0 };
      const quantity = counts.adult + counts.child + counts.infant;
      if (!pkg) return { id, name: "Package no longer available", quantity: "Review package" };
      return {
        id,
        name: pkg.name,
        quantity:
          pkg.sale_unit === "package"
            ? quantity === 0
              ? "Set units"
              : `${quantity} ${quantity === 1 ? "unit" : "units"} · covers ${quantity * pkg.participants_per_unit} guests`
            : `${quantity} ${quantity === 1 ? "guest" : "guests"}`,
      };
    }),
    ...purchase.activityIds.map((id) => {
      const activity = activities.find((item) => item.id === id);
      const counts = purchase.activityParticipants[id] ?? { adult: 0, child: 0, infant: 0 };
      const guests = counts.adult + counts.child + counts.infant;
      const units = activity ? unitsForParticipants(guests, activity.participants_per_unit) : guests;
      return {
        id,
        name: activity?.name ?? "Activity no longer available",
        quantity:
          activity && activity.participants_per_unit > 1
            ? `${guests} ${guests === 1 ? "guest" : "guests"} · ${units} ${units === 1 ? "unit" : "units"}`
            : `${guests} ${guests === 1 ? "guest" : "guests"}`,
      };
    }),
  ];
  const adjustedOperatorBalance =
    quote?.operator_net_total_cents == null
      ? null
      : cents(Math.max(0, quote.operator_net_total_cents - (reductionValue ?? 0)));

  if (savedBookingId) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <Alert variant="success">
          {totalPresent > 0
            ? "Booking and attendance are saved. The waiver QR below is for guests present. If QR generation fails, the booking remains saved and you can retry here or from booking details."
            : "Booking and attendance are saved. No guests were marked present, so no waiver QR was generated."}
        </Alert>
        <WaiverManager
          bookingId={savedBookingId}
          serviceDate={serviceDate}
          required={attendancePresent}
          signers={[]}
          canManage
          autoGenerate
        />
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href={`/bookings/${savedBookingId}`}>Open booking details</Link>
          </Button>
          <Button asChild>
            <Link href="/bookings/new">New booking</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        // Enter in a text field must not create a booking accidentally.
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <div className="flex min-w-0 flex-col gap-6">
        {/* 1. CLIENT */}
        <Section n={1} title="Client and hotel">
          <p className="text-muted-foreground text-sm">
            {preRegistration
              ? "Confirm the client and record who arrived. The waiver QR will be for guests present."
              : "Enter the main booking contact. After saving, the waiver QR will be for guests present."}
          </p>
          {chosenClient ? (
            <div className="bg-success-surface flex flex-wrap items-center justify-between gap-3 rounded-md px-4 py-3">
              <div className="flex items-center gap-2">
                <UserCheckIcon className="text-success size-5" aria-hidden />
                <span className="font-semibold">
                  {chosenClient.first_name} {chosenClient.last_name}
                </span>
                <span className="text-muted-foreground text-sm">
                  {[formatPhone(chosenClient.phone_e164), chosenClient.email].filter(Boolean).join(" · ")} ·{" "}
                  {preRegistration
                    ? "Pre-registered client"
                    : `${chosenClient.booking_count} previous booking${chosenClient.booking_count === 1 ? "" : "s"}`}
                </span>
              </div>
              {!preRegistration && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setChosenClient(null);
                  }}
                >
                  Change client
                </Button>
              )}
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
          <div className="border-t pt-4">
            <h3 className="font-semibold">Hotel</h3>
            <p className="text-muted-foreground mt-1 text-sm">Record the hotel the client came from.</p>
            <div className="mt-3 flex max-w-xl flex-col gap-2">
              <Label htmlFor="hotel_name">
                Hotel name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="hotel_name"
                value={hotelName}
                maxLength={120}
                onChange={(event) => setHotelName(event.target.value)}
                placeholder="e.g. Hotel or resort name"
              />
            </div>
          </div>
        </Section>

        {/* 2. SOURCE */}
        <Section n={2} title="Tour operator and who pays">
          {changingOperator ? (
            <div className="flex flex-col gap-4">
              <fieldset className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <legend className="sr-only">Change tour operator</legend>
                {operators.map((option) => {
                  const selected = operatorId === option.id;
                  return (
                    <label
                      key={option.id}
                      className={cn(
                        "flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border-2 p-3",
                        selected ? "border-primary bg-accent" : "border-border",
                      )}
                    >
                      <input
                        type="radio"
                        name="booking_operator"
                        checked={selected}
                        onChange={() => {
                          setOperatorId(option.id);
                          setPrebookReduction("");
                          setPrebookReductionReason("");
                        }}
                        className="accent-primary size-5 shrink-0"
                      />
                      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white p-1">
                        {option.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- operator logos are stored in Supabase Storage
                          <img src={option.logoUrl} alt="" aria-hidden className="size-full object-contain" />
                        ) : (
                          <UserCheckIcon className="text-primary/70 size-6" aria-hidden />
                        )}
                      </div>
                      <span className="min-w-0">
                        <span className="block font-semibold">{option.name}</span>
                        <span className="text-muted-foreground text-sm">
                          {option.payer === "operator" ? "Operator owes AquaSail" : "Customer pays at reception"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <div>
                <Button type="button" variant="outline" onClick={() => setChangingOperator(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : operator ? (
            <div className="bg-card flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white p-2">
                  {operator.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- operator logos are stored in Supabase Storage
                    <img src={operator.logoUrl} alt={`${operator.name} logo`} className="size-full object-contain" />
                  ) : (
                    <UserCheckIcon className="text-primary/70 size-8" aria-hidden />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{operator.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {operator.payer === "operator" ? "Operator owes AquaSail" : "Customer pays at reception"}
                  </p>
                </div>
              </div>
              <Button type="button" variant="outline" onClick={() => setChangingOperator(true)}>
                Change operator
              </Button>
            </div>
          ) : null}
          {operator && <PayerBanner operatorName={operator.name} payer={operator.payer} />}
        </Section>

        {/* 3. GUESTS AND ACTIVITIES */}
        <Section n={3} title="Guests and activities">
          <div>
            <h3 className="font-semibold">Expected guests and guests present</h3>
            <p className="text-muted-foreground text-sm">
              Record who arrived. Individual activity counts start from guests present; package units are confirmed
              separately. The waiver QR uses the present count.
            </p>
            <div className="mt-3 flex flex-col gap-3">
              {(
                [
                  { key: "adult", label: "Adults", hint: null },
                  { key: "child", label: "Children", hint: "(2–11)" },
                  { key: "infant", label: "Infants", hint: "(under 2)" },
                ] as const
              ).map(({ key, label, hint }) => (
                <div
                  key={key}
                  className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(7rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_5rem] sm:items-end"
                >
                  <p className="font-semibold sm:pb-3">
                    {label} {hint && <span className="text-muted-foreground font-normal">{hint}</span>}
                  </p>
                  <Stepper
                    id={"expected-" + key}
                    label="Expected guests"
                    value={purchase.participants[key]}
                    onChange={(count) =>
                      updatePurchase({
                        ...purchase,
                        participants: { ...purchase.participants, [key]: count },
                      })
                    }
                    compact
                  />
                  <Stepper
                    id={"present-" + key}
                    label="Guests present"
                    value={attendancePresent[key]}
                    onChange={(count) => updatePresentCount(key, count)}
                    compact
                  />
                  <div className="text-sm sm:pb-2">
                    <span className="text-muted-foreground">Absent</span>
                    <p className="font-semibold tabular-nums">{absent[key]}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="bg-muted mt-3 rounded-md px-3 py-2 text-sm font-semibold">
              Expected guests: {size} · Guests present: {totalPresent} · Absent: {totalAbsent}
            </p>
          </div>

          {preRegistration?.expectedPax === null && !legacyExpectedPaxConfirmed && (
            <Alert variant="warning">
              <p className="font-semibold">Expected guests were not recorded on this older pre-registration.</p>
              <p className="mt-1 text-sm">
                Review the expected guest counts above, then confirm them before completing the booking.
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={size === 0}
                onClick={() => setLegacyExpectedPaxConfirmed(true)}
              >
                Confirm {size} expected {size === 1 ? "guest" : "guests"}
              </Button>
            </Alert>
          )}

          <p className="text-muted-foreground border-t pt-4 text-sm">
            Next, choose the packages and activities for this group, then set how many guests will take part in each.
          </p>
          <PurchasePicker
            packages={packages}
            activities={activities}
            tilePrices={context.tilePrices}
            presentParticipants={attendancePresent}
            value={purchase}
            onChange={updatePurchase}
          />
          {lines.length > 0 && size < requiredPartySize && (
            <Alert variant="warning">
              The selected items need at least {requiredPartySize} guests, but {size} are expected. Increase the
              expected count above or reduce the item quantities.
            </Alert>
          )}

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
                Do not collect from the client here. The final check shows the balance {operator.name} owes AquaSail.
              </p>
              {totalAbsent > 0 && (
                <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="booking-prebook-reduction">Agreed reduction to operator balance (Rs)</Label>
                    <Input
                      id="booking-prebook-reduction"
                      inputMode="decimal"
                      maxLength={20}
                      placeholder="Leave blank if there is no reduction"
                      value={prebookReduction}
                      onChange={(event) => setPrebookReduction(event.target.value)}
                    />
                  </div>
                  {prebookReduction.trim() && reductionValue !== null && reductionValue > 0 && (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="booking-prebook-reason">Reason for reduction</Label>
                      <Input
                        id="booking-prebook-reason"
                        maxLength={200}
                        placeholder="e.g. 2 guests did not attend"
                        value={prebookReductionReason}
                        onChange={(event) => setPrebookReductionReason(event.target.value)}
                      />
                    </div>
                  )}
                  <p className="text-muted-foreground text-sm sm:col-span-2">
                    Enter only the agreed amount. The system does not calculate a reduction from absent guests.
                  </p>
                </div>
              )}
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

      {/* FINAL REVIEW */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <h2 className="font-display text-lg font-semibold">Final check</h2>
            <section aria-label="Guest and activity summary" className="flex flex-col gap-3 border-b pb-4">
              <div>
                <h3 className="text-sm font-semibold">Guests</h3>
                <p className="text-muted-foreground text-sm">
                  Expected {size} · Present {totalPresent}
                </p>
                <p className="text-muted-foreground text-xs">
                  Adults {purchase.participants.adult} expected, {attendancePresent.adult} present · Children{" "}
                  {purchase.participants.child} expected, {attendancePresent.child} present · Infants{" "}
                  {purchase.participants.infant} expected, {attendancePresent.infant} present
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold">Activities and packages</h3>
                {selectedProductSummary.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-1 text-sm">
                    {selectedProductSummary.map((item) => (
                      <li key={`${item.id}-${item.name}`} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{item.name}</span>
                        <span className="shrink-0 text-right tabular-nums">{item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">No items selected</p>
                )}
              </div>
              <p className="text-sm">
                <span className="font-semibold">Waiver QR:</span> for {totalPresent} present{" "}
                {totalPresent === 1 ? "guest" : "guests"}
              </p>
              <div className="border-t pt-3 text-sm">
                <p className="font-semibold">Operator balance owed to AquaSail</p>
                {!payerIsOperator ? (
                  <p className="text-muted-foreground">Not applicable · customer pays at reception</p>
                ) : adjustedOperatorBalance !== null ? (
                  <>
                    <p className="tabular-nums">After adjustment: {formatRs(adjustedOperatorBalance)}</p>
                    {reductionValue !== null && reductionValue > 0 && (
                      <p className="text-muted-foreground tabular-nums">
                        Original {formatRs(quote!.operator_net_total_cents!)} − {formatRs(reductionValue)} agreed
                        reduction
                      </p>
                    )}
                  </>
                ) : !quote && !quoteError ? (
                  <p className="text-muted-foreground">Add items to calculate the balance</p>
                ) : quoteStale ? (
                  <p className="text-muted-foreground">Updating balance…</p>
                ) : (
                  <p className="text-muted-foreground">Not available for your account</p>
                )}
              </div>
            </section>
            <QuotePanel
              quote={quote}
              error={quoteError}
              stale={quoteStale}
              empty={lines.length === 0}
              changeDue={changeDue}
              packages={packages}
            />
            {submitError && <Alert variant="destructive">{submitError}</Alert>}
            {blocker && !quoteError && lines.length > 0 && <p className="text-muted-foreground text-sm">{blocker}</p>}
            <Button type="submit" size="lg" disabled={!!blocker || submitting} className="w-full">
              {submitting ? "Saving…" : "Save booking"}
            </Button>
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}
