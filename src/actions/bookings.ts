"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { parseDateInput } from "@/lib/dates";
import { friendlyDbError } from "@/lib/db-errors";
import { cents, toCents, type Cents } from "@/lib/money";
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
