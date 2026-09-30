import { describe, expect, it } from "vitest";
import { ticketState } from "./ticket-state";

describe("ticketState", () => {
  const base = { revoked: false, delivered: false, redeemed: 0, entitled: 9 };

  it("walks issued, delivered, partly used, fully used", () => {
    expect(ticketState(base)).toBe("Issued");
    expect(ticketState({ ...base, delivered: true })).toBe("Delivered");
    expect(ticketState({ ...base, delivered: true, redeemed: 3 })).toBe("Partly used");
    expect(ticketState({ ...base, redeemed: 9 })).toBe("Fully used");
  });

  it("an offline over-redemption still reads as fully used", () => {
    expect(ticketState({ ...base, redeemed: 10 })).toBe("Fully used");
  });

  it("revoked wins over everything", () => {
    expect(ticketState({ ...base, revoked: true, redeemed: 9 })).toBe("Revoked");
  });

  it("a booking with nothing redeemable is never 'fully used'", () => {
    expect(ticketState({ ...base, entitled: 0 })).toBe("Issued");
  });
});
