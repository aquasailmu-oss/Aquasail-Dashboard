"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { toCents } from "@/lib/money";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  booking_id: z.uuid(),
  adults_present: z.number().int().min(0).max(500),
  children_present: z.number().int().min(0).max(500),
  infants_present: z.number().int().min(0).max(500),
  prebook_reduction: z.string().trim().max(20),
  prebook_reduction_reason: z.string().trim().max(200),
});

export type RecordAttendanceInput = z.input<typeof schema>;

export async function recordAttendance(input: RecordAttendanceInput): Promise<Result<null>> {
  const auth = await authorize(["admin", "receptionist"]);
  if (!auth.ok) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the attendance details.");
  const d = parsed.data;
  let reductionCents = 0;
  if (d.prebook_reduction) {
    try {
      reductionCents = toCents(d.prebook_reduction);
    } catch {
      return fail("Enter the operator balance reduction in rupees, for example 1250.00.");
    }
  }
  if (reductionCents < 0) return fail("The operator balance reduction cannot be negative.");
  if (reductionCents > 0 && !d.prebook_reduction_reason.trim()) {
    return fail("Add a short reason for the balance reduction.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_booking_attendance", {
    p_booking_id: d.booking_id,
    p_adults_present: d.adults_present,
    p_children_present: d.children_present,
    p_infants_present: d.infants_present,
    p_prebook_reduction_cents: reductionCents,
    p_prebook_reduction_reason: d.prebook_reduction_reason || undefined,
  });
  if (error) {
    if (/cannot exceed the booked count/i.test(error.message))
      return fail("Attended guests cannot exceed the booked count.");
    if (/pre-book reduction/i.test(error.message)) {
      if (/cannot exceed/i.test(error.message)) {
        return fail("The reduction cannot be greater than the amount the operator owes AquaSail.");
      }
      if (/only be entered when guests did not attend/i.test(error.message)) {
        return fail("A balance reduction can only be entered when someone did not attend.");
      }
      return fail("Check the operator balance reduction and try again.");
    }
    if (/cancelled/i.test(error.message)) return fail("Attendance cannot be recorded for a cancelled booking.");
    return fail("Attendance could not be saved. Refresh the booking and try again.");
  }

  revalidatePath(`/bookings/${d.booking_id}`);
  revalidatePath("/bookings");
  revalidatePath("/today");
  revalidatePath("/register");
  return ok(null);
}
