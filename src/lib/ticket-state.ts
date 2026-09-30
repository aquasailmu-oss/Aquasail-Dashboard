/**
 * A ticket's state in words (V2 plan §8.1). Derived every time from the
 * ticket, its deliveries and its booking's redemptions; never stored, so it
 * cannot disagree with the event log.
 */
export type TicketState = "Issued" | "Delivered" | "Partly used" | "Fully used" | "Revoked";

export function ticketState(t: {
  revoked: boolean;
  delivered: boolean;
  /** Units redeemed across the booking's redeemable entitlements (reversals net out). */
  redeemed: number;
  /** Units the booking's redeemable entitlements add up to. */
  entitled: number;
}): TicketState {
  if (t.revoked) return "Revoked";
  if (t.entitled > 0 && t.redeemed >= t.entitled) return "Fully used";
  if (t.redeemed > 0) return "Partly used";
  if (t.delivered) return "Delivered";
  return "Issued";
}
