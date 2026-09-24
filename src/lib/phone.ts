import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/**
 * Phone numbers are stored in E.164 ("+23057001234"). Reception types them
 * however the guest says them; a number without a country code is taken to
 * be Mauritian.
 */
export type PhoneResult = { ok: true; e164: string } | { ok: false; error: string };

export function normalizePhone(input: string): PhoneResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Enter a phone number." };
  // "00 44 ..." is how many guests write an international number.
  const candidate = trimmed.replace(/^00/, "+");
  const parsed = parsePhoneNumberFromString(candidate, "MU");
  if (!parsed || !parsed.isPossible()) {
    return {
      ok: false,
      error: "That phone number does not look right. For a foreign number, start with + and the country code.",
    };
  }
  return { ok: true, e164: parsed.number };
}

/** "+230 5700 1234", "+44 7700 900123". Falls back to the stored value. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
