"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { toCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  booking: z.uuid(),
  item: z.union([z.uuid(), z.literal("")]),
  status: z.enum(["automatic", "manual", "none", "pending", "recorded"]),
  amount: z.string().trim().max(20),
  reason: z.string().trim().max(200),
});

export async function saveSettlement(_: string, form: FormData): Promise<string> {
  const auth = await authorize(["admin", "receptionist"]);
  if (!auth.ok) return auth.error;
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return "Check the settlement details.";
  const { booking, item, status, amount, reason } = parsed.data;
  if (Boolean(item) !== (status === "automatic" || status === "manual")) return "Choose a valid status.";
  let value = null;
  try {
    if (amount && (status === "manual" || status === "recorded")) value = toCents(amount);
  } catch {
    return "Enter a valid amount in rupees.";
  }
  if (status === "recorded" && (!value || !reason)) return "Enter a nonzero adjustment and a reason.";
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_booking_settlement", {
    p_booking_id: booking,
    p_item_id: item || null,
    p_manual: status === "manual",
    p_aquasail: item ? value : null,
    p_adjustment_status: status,
    p_adjustment_cents: status === "recorded" ? value : null,
    p_reason: status === "recorded" ? reason : null,
  });
  if (error?.code === "23514") return "The AquaSail share must be between zero and the line total.";
  if (error) return "Settlement could not be saved. Refresh the booking and try again.";
  revalidatePath(`/bookings/${booking}`);
  revalidatePath("/today");
  return "Saved.";
}
