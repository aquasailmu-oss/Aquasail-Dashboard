"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const staffRoles = ["admin", "receptionist"] as const;
const schema = z.object({
  client_id: z.uuid().nullable(),
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().max(80),
  phone: z.string().trim().max(40),
  email: z.union([z.literal(""), z.email().trim().toLowerCase()]),
  country: z.string().trim().max(60),
  operator_id: z.uuid(),
  service_date: z.string(),
  notes: z.string().trim().max(1000),
});

export type CreatePreRegistrationInput = z.input<typeof schema>;

export async function createPreRegistration(input: CreatePreRegistrationInput): Promise<Result<{ id: string }>> {
  const auth = await authorize(staffRoles);
  if (!auth.ok) return auth;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the client details and try again.");
  const d = parsed.data;
  const serviceDate = parseDateInput(d.service_date);
  if (!serviceDate) return fail("Choose today or a future visit date.");

  let phone: string | null = null;
  if (d.phone) {
    const result = normalizePhone(d.phone);
    if (!result.ok) return fail(result.error);
    phone = result.e164;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_booking_pre_registration", {
    p_first_name: d.first_name,
    p_last_name: d.last_name,
    p_operator_id: d.operator_id,
    p_service_date: serviceDate,
    p_client_id: d.client_id ?? undefined,
    p_phone_e164: phone ?? undefined,
    p_email: d.email || undefined,
    p_country: d.country || undefined,
    p_notes: d.notes || undefined,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data) || typeof data.id !== "string") {
    const message = error?.message ?? "The pre-registration could not be saved.";
    if (/already exists/i.test(message)) return fail(message);
    if (/future visit date/i.test(message)) return fail("Choose today or a future visit date.");
    return fail("The pre-registration could not be saved. Check the details and try again.");
  }
  revalidatePath("/pre-registrations");
  revalidatePath("/bookings/new");
  return ok({ id: data.id });
}
