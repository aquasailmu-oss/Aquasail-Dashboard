import { z } from "zod";

/**
 * The scan payload from scan_ticket() / scan_reference() (migrations 0021,
 * 0023), parsed rather than cast: the island app renders exactly these
 * fields and nothing else. It never carries money or contact details.
 */

export const VERDICTS = [
  "VALID",
  "PARTLY_USED",
  "ALREADY_REDEEMED",
  "WRONG_DATE",
  "CANCELLED",
  "REVOKED",
  "NOT_FOUND",
] as const;
export type Verdict = (typeof VERDICTS)[number];

const eventSchema = z.object({
  redemption_id: z.string(),
  quantity: z.number().int(),
  at: z.string(),
  by_name: z.string().nullable(),
  location_name: z.string().nullable(),
  device_label: z.string().nullable(),
  is_reversal: z.boolean(),
});

const entitlementSchema = z.object({
  booking_activity_id: z.string(),
  activity_code: z.string(),
  activity_name: z.string(),
  participant_type: z.enum(["adult", "child", "infant"]).nullable(),
  quantity: z.number().int(),
  redeemed: z.number().int(),
  remaining: z.number().int(),
  events: z.array(eventSchema),
});

const foundSchema = z.object({
  verdict: z.enum(VERDICTS).exclude(["NOT_FOUND"]),
  booking_id: z.string(),
  reference: z.string(),
  client_surname: z.string(),
  client_first_initial: z.string(),
  adults: z.number().int(),
  children: z.number().int(),
  infants: z.number().int(),
  service_date: z.string(),
  departure_time: z.string().nullable(),
  meeting_point: z.string().nullable(),
  checked_in_at: z.string().nullable(),
  checked_in_by_name: z.string().nullable(),
  entitlements: z.array(entitlementSchema),
  not_included: z.array(z.object({ activity_code: z.string(), activity_name: z.string() })),
});

export const scanResultSchema = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("NOT_FOUND") }),
  foundSchema,
]);

export type ScanResult = z.infer<typeof scanResultSchema>;
export type ScanEntitlement = z.infer<typeof entitlementSchema>;
export type ScanEvent = z.infer<typeof eventSchema>;

/**
 * The ticket token inside a scanned QR: the code holds the ticket URL
 * (https://<host>/tickets/<token>), or, if someone printed it bare, the
 * token alone. Anything else is not an AquaSail ticket.
 */
export function tokenFromQr(text: string): string | null {
  const match = /(?:^|\/tickets\/)([0-9a-f]{32})(?:[/?#]|$)/.exec(text.trim());
  return match?.[1] ?? null;
}

/** "4 adults, 1 child" */
export function partySize(r: { adults: number; children: number; infants: number }): string {
  const part = (n: number, one: string, many: string) => (n > 0 ? `${n} ${n === 1 ? one : many}` : null);
  return (
    [part(r.adults, "adult", "adults"), part(r.children, "child", "children"), part(r.infants, "infant", "infants")]
      .filter(Boolean)
      .join(", ") || "No one"
  );
}

/** What redeem_activity() and reverse_redemption() return (migration 0020). */
export const redeemResultSchema = z.object({
  redemption_id: z.string(),
  booking_activity_id: z.string(),
  entitlement_quantity: z.number().int(),
  redeemed_total: z.number().int(),
  remaining: z.number().int(),
});
export type RedeemResult = z.infer<typeof redeemResultSchema>;

/** What check_in_booking() returns: the arrival, and the entitlements to show straight after. */
export const checkInResultSchema = z.object({
  checked_in_at: z.string(),
  checked_in_by_name: z.string().nullable(),
  already_checked_in: z.boolean(),
  entitlements: z.array(entitlementSchema),
});
export type CheckInResult = z.infer<typeof checkInResultSchema>;

export function partyCount(r: { adults: number; children: number; infants: number }): number {
  return r.adults + r.children + r.infants;
}
