/**
 * Money is integer cents everywhere inside the system (bigint in Postgres,
 * the branded Cents type here). Rs 1,500.00 is 150000. Formatting happens
 * only at the edges, and only through formatRs().
 */

declare const centsBrand: unique symbol;
export type Cents = number & { readonly [centsBrand]: true };

/** Brand an integer that is already in cents (e.g. a value read from the database). */
export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Not a whole number of cents: ${value}`);
  }
  return value as Cents;
}

/**
 * Convert a rupee amount to cents. Accepts a number or a user-typed string
 * ("1500", "1,500.5", "Rs 1500.50"). Strings are parsed digit-by-digit, so
 * no floating-point rounding is ever involved for typed input.
 */
export function toCents(rupees: number | string): Cents {
  if (typeof rupees === "number") {
    if (!Number.isFinite(rupees)) throw new Error(`Invalid amount: ${rupees}`);
    return cents(Math.round(rupees * 100));
  }
  const cleaned = rupees.replace(/rs\.?/i, "").replace(/[,\s]/g, "");
  const match = /^(-)?(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match || (match[2] === "" && !match[3])) {
    throw new Error(`Invalid amount: "${rupees}"`);
  }
  const [, sign, whole, frac = ""] = match;
  const value = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0"));
  return cents(sign ? -value : value);
}

/** Cents to rupees as a number — for inputs and exports only, never for arithmetic. */
export function fromCents(value: Cents): number {
  return value / 100;
}

export function addCents(...values: Cents[]): Cents {
  return cents(values.reduce<number>((sum, v) => sum + v, 0));
}

/** "Rs 1,500" for whole amounts, "Rs 1,500.50" otherwise, "-Rs 200" for negatives. */
export function formatRs(value: Cents): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = frac === 0 ? wholeStr : `${wholeStr}.${frac.toString().padStart(2, "0")}`;
  return `${negative ? "-" : ""}Rs ${body}`;
}
