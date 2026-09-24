"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { parseDateInput } from "@/lib/dates";
import { friendlyDbError } from "@/lib/db-errors";
import { cents, formatRs, toCents, type Cents } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";
import { parseDiscount } from "@/lib/pricing/discount";
import { fetchQuote } from "@/lib/pricing/quote";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const WRITERS = ["admin", "receptionist"] as const;

// ---------------------------------------------------------------------------
// Context for the booking form: package tile prices and boat loads for a date.
// ---------------------------------------------------------------------------

export type BookingContext = {
  /** Adult price per package for this date and source; null when not priced. */
  tilePrices: Record<string, Cents | null>;
  /** People already booked per boat on this date (cancelled bookings excluded). */
  fleetLoad: Record<string, number>;
};

const contextSchema = z.object({ service_date: z.string(), operator_id: z.uuid().nullable() });

export async function bookingContext(input: z.input<typeof contextSchema>): Promise<Result<BookingContext>> {
  const auth = await authorize(WRITERS);
  if (!auth.ok) return auth;
  const parsed = contextSchema.safeParse(input);
  const date = parsed.success ? parseDateInput(parsed.data.service_date) : null;
  if (!parsed.success || !date) return fail("Choose the service date.");

  const supabase = await createClient();
  const [{ data: packages }, { data: bookings }] = await Promise.all([
    supabase.from("packages").select("id").eq("is_active", true),
    supabase
      .from("bookings")
      .select("resource_id, booking_participants(count)")
      .eq("service_date", date)
      .neq("status", "cancelled")
      .not("resource_id", "is", null),
  ]);

  const tilePrices: Record<string, Cents | null> = {};
  await Promise.all(
    (packages ?? []).map(async (p) => {
      const quote = await fetchQuote(supabase, {
        service_date: date,
        operator_id: parsed.data.operator_id,
        lines: [{ target_type: "package", target_id: p.id, participant_type: "adult", quantity: 1 }],
        discount: null,
      });
      tilePrices[p.id] = quote.ok ? quote.data.charged_total_cents : null;
    }),
  );

  const fleetLoad: Record<string, number> = {};
  for (const b of bookings ?? []) {
    if (!b.resource_id) continue;
    const people = b.booking_participants.reduce((sum, p) => sum + p.count, 0);
    fleetLoad[b.resource_id] = (fleetLoad[b.resource_id] ?? 0) + people;
  }
  return ok({ tilePrices, fleetLoad });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const createSchema = z.object({
  idempotency_key: z.uuid(),
  client_id: z.uuid().nullable(),
  client: z.object({
    first_name: z.string().trim().max(80),
    last_name: z.string().trim().max(80),
    phone: z.string().trim().max(40),
    email: z.union([z.literal(""), z.email("Enter a valid email address, or leave it empty.").trim().toLowerCase()]),
    country: z.string().trim().max(60),
  }),
  service_date: z.string(),
  operator_id: z.uuid().nullable(),
  lines: z
    .array(
      z.object({
        target_type: z.enum(["package", "activity"]),
        target_id: z.uuid(),
        participant_type: z.enum(["adult", "child", "infant"]),
        quantity: z.number().int().min(1).max(500),
      }),
    )
    .min(1, "Choose a package or add an activity."),
  participants: z.object({
    adult: z.number().int().min(0).max(500),
    child: z.number().int().min(0).max(500),
    infant: z.number().int().min(0).max(500),
  }),
  discount: z.object({ type: z.enum(["amount", "percent"]), value: z.string(), reason: z.string() }).nullable(),
  departure_time: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/, "Enter the departure time as HH:MM.")]),
  meeting_point: z.string().trim().max(200),
  notes: z.string().trim().max(1000),
  resource_id: z.uuid().nullable(),
  payment: z
    .object({
      method: z.enum(["cash", "card", "bank_transfer", "other"]),
      received: z.string(),
      reference: z.string().trim().max(100),
    })
    .nullable(),
  expected_total_cents: z.number().int().min(0),
});

export type CreateBookingInput = z.input<typeof createSchema>;

export async function createBooking(input: CreateBookingInput): Promise<Result<{ id: string; reference: string }>> {
  const auth = await authorize(WRITERS);
  if (!auth.ok) return auth;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the booking and try again.");
  const d = parsed.data;

  const date = parseDateInput(d.service_date);
  if (!date) return fail("Choose the service date.");
  if (d.participants.adult + d.participants.child + d.participants.infant === 0) {
    return fail("Add at least one participant.");
  }

  let client: Record<string, string | null> | null = null;
  if (!d.client_id) {
    if (!d.client.first_name) return fail("Enter the client's first name.");
    let phone: string | null = null;
    if (d.client.phone) {
      const normalized = normalizePhone(d.client.phone);
      if (!normalized.ok) return fail(normalized.error);
      phone = normalized.e164;
    }
    client = {
      first_name: d.client.first_name,
      last_name: d.client.last_name,
      phone_e164: phone,
      email: d.client.email || null,
      country: d.client.country || null,
    };
  }

  const discount = d.discount ? parseDiscount(d.discount) : { ok: true as const, data: null };
  if (!discount.ok) return discount;

  // What was received pays for the booking up to its total; the rest is change.
  let payment: { amount_cents: Cents; method: string; reference: string | null } | null = null;
  if (d.payment && d.payment.received.trim()) {
    let received: Cents;
    try {
      received = toCents(d.payment.received);
    } catch {
      return fail("Enter the amount received in rupees, e.g. 3400.");
    }
    if (received <= 0) return fail("Enter the amount received, or leave it empty for an unpaid booking.");
    payment = {
      amount_cents: cents(Math.min(received, d.expected_total_cents)),
      method: d.payment.method,
      reference: d.payment.reference || null,
    };
    if (payment.amount_cents === 0) payment = null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_booking", {
    payload: {
      idempotency_key: d.idempotency_key,
      client_id: d.client_id,
      client,
      service_date: date,
      operator_id: d.operator_id,
      lines: d.lines,
      discount: discount.data,
      participants: (["adult", "child", "infant"] as const)
        .filter((t) => d.participants[t] > 0)
        .map((t) => ({ participant_type: t, count: d.participants[t] })),
      departure_time: d.departure_time || null,
      meeting_point: d.meeting_point || null,
      notes: d.notes || null,
      resource_id: d.resource_id,
      payment,
      expected_total_cents: d.expected_total_cents,
    } as unknown as Json,
  });
  if (error) return fail(friendlyDbError(error, "The booking could not be saved. Nothing was charged; try again."));

  const result = data as { booking_id: string; reference: string };
  revalidatePath("/today");
  revalidatePath("/bookings");
  return ok({ id: result.booking_id, reference: result.reference });
}

// ---------------------------------------------------------------------------
// Amend, cancel, payments (WP-16)
// ---------------------------------------------------------------------------

const lineSchema = z.object({
  target_type: z.enum(["package", "activity"]),
  target_id: z.uuid(),
  participant_type: z.enum(["adult", "child", "infant"]),
  quantity: z.number().int().min(1).max(500),
});

const amendSchema = z.object({
  booking_id: z.uuid(),
  lines: z.array(lineSchema).min(1, "Choose a package or add an activity."),
  participants: createSchema.shape.participants,
  discount: createSchema.shape.discount,
  departure_time: createSchema.shape.departure_time,
  meeting_point: createSchema.shape.meeting_point,
  notes: createSchema.shape.notes,
  resource_id: z.uuid().nullable(),
  expected_total_cents: z.number().int().min(0),
});

export type AmendBookingInput = z.input<typeof amendSchema>;

export async function amendBooking(
  input: AmendBookingInput,
): Promise<Result<{ previous: Cents; total: Cents; paid: Cents }>> {
  const auth = await authorize(WRITERS);
  if (!auth.ok) return auth;
  const parsed = amendSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the booking and try again.");
  const d = parsed.data;
  const discount = d.discount ? parseDiscount(d.discount) : { ok: true as const, data: null };
  if (!discount.ok) return discount;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("amend_booking", {
    p_booking_id: d.booking_id,
    payload: {
      lines: d.lines,
      discount: discount.data,
      participants: (["adult", "child", "infant"] as const)
        .filter((t) => d.participants[t] > 0)
        .map((t) => ({ participant_type: t, count: d.participants[t] })),
      departure_time: d.departure_time || null,
      meeting_point: d.meeting_point || null,
      notes: d.notes || null,
      resource_id: d.resource_id,
      expected_total_cents: d.expected_total_cents,
    } as unknown as Json,
  });
  if (error) return fail(friendlyDbError(error, "The changes could not be saved. Nothing was changed; try again."));
  const r = data as { previous_total_cents: number; charged_total_cents: number; paid_cents: number };
  revalidatePath(`/bookings/${d.booking_id}`);
  revalidatePath("/today");
  revalidatePath("/bookings");
  return ok({
    previous: cents(r.previous_total_cents),
    total: cents(r.charged_total_cents),
    paid: cents(r.paid_cents),
  });
}

const cancelSchema = z.object({
  booking_id: z.uuid(),
  reason: z.string().trim().min(3, "Give a reason for cancelling.").max(500, "Keep the reason under 500 characters."),
});

/** Cancels (never deletes). Who and when are stamped by the database. */
export async function cancelBooking(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(WRITERS);
  if (!auth.ok) return auth;
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Give a reason for cancelling.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", cancellation_reason: parsed.data.reason })
    .eq("id", parsed.data.booking_id)
    .neq("status", "cancelled")
    .select("id");
  if (error) return fail(friendlyDbError(error, "The booking could not be cancelled. Try again."));
  if (!data?.length) {
    return fail(
      auth.data.role === "receptionist"
        ? "This booking's date has passed or it is already cancelled. Only an admin can cancel a past booking."
        : "This booking is already cancelled.",
    );
  }
  revalidatePath(`/bookings/${parsed.data.booking_id}`);
  revalidatePath("/today");
  revalidatePath("/bookings");
  return ok(null);
}

const paymentSchema = z.object({
  booking_id: z.uuid(),
  amount: z.string(),
  method: z.enum(["cash", "card", "bank_transfer", "operator_account", "other"], { error: "Choose how it was paid." }),
  reference: z.string().trim().max(100),
  note: z.string().trim().max(500),
});

async function balanceDue(bookingId: string): Promise<Result<{ due: number; payer: string }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("charged_total_cents, payer, status, payments(amount_cents)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!data) return fail("That booking could not be found.");
  const paid = data.payments.reduce((sum, p) => sum + p.amount_cents, 0);
  return ok({ due: data.charged_total_cents - paid, payer: data.payer });
}

export async function recordPayment(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(WRITERS);
  if (!auth.ok) return auth;
  const parsed = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the payment and try again.");
  let amount: Cents;
  try {
    amount = toCents(parsed.data.amount);
  } catch {
    return fail("Enter the amount in rupees, e.g. 1500.");
  }
  if (amount <= 0) return fail("Enter an amount above zero.");
  const balance = await balanceDue(parsed.data.booking_id);
  if (!balance.ok) return balance;
  if (amount > balance.data.due) {
    return fail(
      `That is more than the balance due (${formatRs(cents(Math.max(0, balance.data.due)))}). Give the rest back as change.`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({
    booking_id: parsed.data.booking_id,
    amount_cents: amount,
    method: parsed.data.method,
    received_from: parsed.data.method === "operator_account" ? "operator" : "client",
    reference: parsed.data.reference || null,
    note: parsed.data.note || null,
  });
  if (error) return fail(friendlyDbError(error, "The payment could not be recorded. Try again."));
  revalidatePath(`/bookings/${parsed.data.booking_id}`);
  revalidatePath("/today");
  return ok(null);
}

const correctionSchema = z.object({
  payment_id: z.uuid(),
  amount: z.string(),
  note: z.string().trim().min(3, "Explain the correction (at least a few words).").max(500),
});

/** Reverses all or part of a payment with a negative row. The original stays visible forever. */
export async function correctPayment(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(WRITERS);
  if (!auth.ok) return auth;
  const parsed = correctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the correction and try again.");
  let amount: Cents;
  try {
    amount = toCents(parsed.data.amount);
  } catch {
    return fail("Enter the amount to reverse in rupees, e.g. 1500.");
  }
  if (amount <= 0) return fail("Enter the amount to reverse, above zero.");

  const supabase = await createClient();
  const { data: original } = await supabase
    .from("payments")
    .select("id, booking_id, method, received_from, is_correction")
    .eq("id", parsed.data.payment_id)
    .maybeSingle();
  if (!original || original.is_correction) return fail("Choose the original payment to correct.");

  const { error } = await supabase.from("payments").insert({
    booking_id: original.booking_id,
    amount_cents: -amount,
    method: original.method,
    received_from: original.received_from,
    is_correction: true,
    corrects_payment_id: original.id,
    note: parsed.data.note,
  });
  if (error) return fail(friendlyDbError(error, "The correction could not be recorded. Try again."));
  revalidatePath(`/bookings/${original.booking_id}`);
  revalidatePath("/today");
  return ok(null);
}
