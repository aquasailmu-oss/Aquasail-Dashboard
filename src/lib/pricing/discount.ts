import { toCents } from "@/lib/money";
import { fail, ok, type Result } from "@/lib/result";
import type { DiscountInput } from "./types";

/**
 * Reception types a discount as "500" (rupees) or "10" (%) with a reason.
 * Returns null for no discount. The cap is enforced by the engine, per role.
 */
export function parseDiscount(input: {
  type: "amount" | "percent";
  value: string;
  reason: string;
}): Result<DiscountInput | null> {
  const value = input.value.trim();
  if (!value) return ok(null);
  const reason = input.reason.trim();
  if (!reason) return fail("Give a reason for the discount.");

  if (input.type === "amount") {
    let amount: number;
    try {
      amount = toCents(value);
    } catch {
      return fail("Enter the discount in rupees, e.g. 500.");
    }
    if (amount <= 0) return fail("Enter a discount above zero, or leave it empty.");
    return ok({ type: "amount", value: amount, reason });
  }

  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.replace(/\s|%/g, ""));
  if (!m) return fail("Enter the discount as a percentage, e.g. 10.");
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (bp <= 0 || bp > 10000) return fail("A percentage discount must be above 0% and at most 100%.");
  return ok({ type: "percent", value: bp, reason });
}
