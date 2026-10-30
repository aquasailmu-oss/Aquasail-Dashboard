import { describe, expect, it } from "vitest";
import { latestTicket } from "@/lib/booking-tickets";

describe("latestTicket", () => {
  it("handles a single-object ticket relationship", () => {
    const ticket = { token: "ticket", issued_at: "2026-10-30T10:00:00Z" };
    expect(latestTicket(ticket)).toBe(ticket);
  });

  it("selects the latest ticket from an array relationship", () => {
    const oldTicket = { token: "old", issued_at: "2026-10-29T10:00:00Z" };
    const newTicket = { token: "new", issued_at: "2026-10-30T10:00:00Z" };
    expect(latestTicket([oldTicket, newTicket])).toBe(newTicket);
  });

  it("handles a missing relationship", () => {
    expect(latestTicket(null)).toBeNull();
    expect(latestTicket(undefined)).toBeNull();
    expect(latestTicket([])).toBeNull();
  });
});
