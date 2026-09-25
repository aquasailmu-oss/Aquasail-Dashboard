import { cents, type Cents } from "@/lib/money";
import { fail, ok, type Result } from "@/lib/result";

/**
 * Parses a signed percentage for a bulk price change ("5", "+7.5", "-10")
 * into whole basis points. Between -90% and +200%, at most 2 decimals.
 */
export function parsePercentChange(value: string): Result<number> {
  const m = /^([+-]?)(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.replace(/\s|%/g, ""));
  if (!m) return fail("Enter the change as a percentage, e.g. 5 for +5% or -10 for a 10% cut.");
  const bp = (Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"))) * (m[1] === "-" ? -1 : 1);
  if (bp === 0) return fail("A 0% change would not change any price.");
  if (bp < -9000 || bp > 20000) return fail("Keep the change between -90% and +200%.");
  return ok(bp);
}

/**
 * Applies a change in basis points and rounds half-up to the nearest whole
 * rupee, in integer arithmetic only: a 5% rise on Rs 1,850 is Rs 1,943, not
 * Rs 1,942.50 and never a float.
 */
export function adjustPrice(price: Cents, basisPoints: number): Cents {
  const numerator = price * (10000 + basisPoints); // cents × 10000
  const denominator = 10000 * 100; // → rupees
  const rupees = Math.floor((2 * numerator + denominator) / (2 * denominator));
  return cents(rupees * 100);
}
