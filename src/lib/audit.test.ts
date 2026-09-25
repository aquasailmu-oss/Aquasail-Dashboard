import { describe as group, expect, it } from "vitest";
import { describe, diffFields, fieldLabel, formatValue, isHidden } from "./audit";

group("audit formatting", () => {
  it("hides ids and bookkeeping columns", () => {
    expect(isHidden("booking_id")).toBe(true);
    expect(isHidden("token")).toBe(true);
    expect(isHidden("updated_at")).toBe(true);
    expect(isHidden("charged_total_cents")).toBe(false);
  });

  it("labels and formats values for people", () => {
    expect(fieldLabel("unit_charged_cents")).toBe("Unit price charged");
    expect(fieldLabel("departure_time")).toBe("Departure time");
    expect(formatValue("charged_total_cents", 640000)).toBe("Rs 6,400");
    expect(formatValue("commission_rate", 0.155)).toBe("15.5%");
    expect(formatValue("service_date", "2026-09-17")).toBe("17 Sep 2026");
    expect(formatValue("departure_time", "09:00:00")).toBe("09:00");
    expect(formatValue("is_active", false)).toBe("No");
    expect(formatValue("notes", null)).toBe("—");
  });

  it("shows only what changed in an update, without internal fields", () => {
    const changes = diffFields(
      "UPDATE",
      { id: "x", notes: null, departure_time: "09:00:00", charged_total_cents: 680000, updated_at: "a" },
      { id: "x", notes: null, departure_time: "10:30:00", charged_total_cents: 930000, updated_at: "b" },
    );
    expect(changes).toEqual([
      { field: "departure_time", label: "Departure time", before: "09:00", after: "10:30" },
      { field: "charged_total_cents", label: "Total charged", before: "Rs 6,800", after: "Rs 9,300" },
    ]);
  });

  it("lists the meaningful fields of a new record", () => {
    const changes = diffFields("INSERT", null, {
      id: "p",
      booking_id: "b",
      amount_cents: 50000,
      method: "cash",
      note: null,
    });
    expect(changes.map((c) => `${c.label}: ${c.after}`)).toEqual(["Amount: Rs 500", "Method: cash"]);
  });

  it("describes entries in plain sentences", () => {
    expect(describe("bookings", "INSERT", null, { charged_total_cents: 640000, service_date: "2026-09-17" })).toBe(
      "Booking created, Rs 6,400 for 17 Sep 2026",
    );
    expect(
      describe("bookings", "UPDATE", { status: "confirmed" }, { status: "cancelled", cancellation_reason: "Weather" }),
    ).toBe("Booking cancelled: Weather");
    expect(describe("payments", "INSERT", null, { amount_cents: -50000, is_correction: true, note: "Twice" })).toBe(
      "Payment corrected: -Rs 500 (Twice)",
    );
    expect(
      describe(
        "booking_items",
        "INSERT",
        null,
        { quantity: 4, participant_type: "adult", unit_charged_cents: 320000 },
        { item: "Island Explorer" },
      ),
    ).toBe("Line added: Island Explorer × 4 adult at Rs 3,200");
    expect(describe("activities", "UPDATE", { name: "Tube" }, { name: "Tube Ride" })).toBe(
      "Activity changed: Tube Ride",
    );
  });
});
