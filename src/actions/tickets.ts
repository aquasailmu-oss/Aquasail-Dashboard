"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { friendlyDbError } from "@/lib/db-errors";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

/** Counts a print, so a reprint is visible on the booking. */
export async function markTicketPrinted(token: string): Promise<Result<number>> {
  const auth = await authorize(["admin", "receptionist"]);
  if (!auth.ok) return auth;
  const t = z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .safeParse(token);
  if (!t.success) return fail("That ticket could not be found.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_ticket_printed", { p_token: t.data });
  if (error || data === null) return fail("The print could not be recorded.");
  revalidatePath("/bookings/[id]", "page");
  return ok(data);
}

const reissueSchema = z.object({
  booking_id: z.uuid(),
  reason: z.string().trim().min(3, "Give a reason for reissuing.").max(300, "Keep the reason under 300 characters."),
});

/** A new ticket for a lost phone or a wrong number; the previous one stops working at once. */
export async function reissueTicket(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(["admin", "receptionist"]);
  if (!auth.ok) return auth;
  const parsed = reissueSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Give a reason for reissuing.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reissue_ticket", {
    p_booking_id: parsed.data.booking_id,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(friendlyDbError(error, "The ticket could not be reissued. Try again."));
  revalidatePath(`/bookings/${parsed.data.booking_id}`);
  return ok(null);
}
