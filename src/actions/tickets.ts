"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
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
