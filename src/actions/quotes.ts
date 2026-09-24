"use server";

import { z } from "zod";
import { authorize } from "@/lib/auth";
import { parseDateInput } from "@/lib/dates";
import { parseDiscount } from "@/lib/pricing/discount";
import { fetchQuote } from "@/lib/pricing/quote";
import type { Quote } from "@/lib/pricing/types";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const quoteSchema = z.object({
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
    .min(1, "Add at least one package or activity.")
    .max(30),
  discount: z.object({ type: z.enum(["amount", "percent"]), value: z.string(), reason: z.string() }).nullable(),
});

export type QuoteRequest = z.input<typeof quoteSchema>;

/** A quote for the booking wizard. Pure read: nothing is written. */
export async function getQuote(input: QuoteRequest): Promise<Result<Quote>> {
  const auth = await authorize(["admin", "receptionist"]);
  if (!auth.ok) return auth;
  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the booking and try again.");
  const date = parseDateInput(parsed.data.service_date);
  if (!date) return fail("Choose the service date.");
  const discount = parsed.data.discount ? parseDiscount(parsed.data.discount) : { ok: true as const, data: null };
  if (!discount.ok) return discount;

  const supabase = await createClient();
  const quote = await fetchQuote(supabase, {
    service_date: date,
    operator_id: parsed.data.operator_id,
    lines: parsed.data.lines,
    discount: discount.data,
  });
  return quote.ok && auth.data.role === "receptionist" ? ok(forReception(quote.data)) : quote;
}

/**
 * Reception never sees what AquaSail earns from an operator: net prices and
 * commission are removed before the quote leaves the server (build plan §8).
 */
function forReception(quote: Quote): Quote {
  return {
    ...quote,
    lines: quote.lines.map((l) => ({
      ...l,
      unit_operator_net_cents: null,
      commission_rate: null,
      commission_cents: null,
    })),
    operator_net_total_cents: null,
    commission_total_cents: null,
  };
}
