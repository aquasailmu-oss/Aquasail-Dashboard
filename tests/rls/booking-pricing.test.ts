import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { anon, createFixtures, expectRaised, expectRefused, service, signInAs } from "./harness";

type Session = Awaited<ReturnType<typeof signInAs>>;
let receptionist: Session, staff: Session;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  [receptionist, staff] = await Promise.all([signInAs("receptionist"), signInAs("activity_staff")]);
  fx = await createFixtures();
});

const line = () => ({ target_type: "activity", target_id: fx.activity.id, participant_type: "adult", quantity: 2 });

describe("build_quote", () => {
  it("prices for reception without exposing the price table", async () => {
    const quote = await receptionist.client.rpc("build_quote", { input: { service_date: fx.today, lines: [line()] } });
    expect(quote.error).toBeNull();
    expect((quote.data as { charged_total_cents: number }).charged_total_cents).toBe(300000);
    expectRefused(await receptionist.client.from("price_rules").select("*"));
  });

  it("is refused to activity staff and anon", async () => {
    expectRaised(
      await staff.client.rpc("build_quote", { input: { service_date: fx.today, lines: [line()] } }),
      "Only office staff can price bookings.",
    );
    expectRefused(await anon.rpc("build_quote", { input: { service_date: fx.today, lines: [line()] } }));
  });
});

describe("create_booking called directly through the API", () => {
  const payload = (expected: number, extra: Record<string, unknown> = {}) => ({
    idempotency_key: randomUUID(),
    client_id: fx.client.id,
    service_date: fx.today,
    lines: [{ ...line(), unit_charged_cents: 1, unit_retail_cents: 1 }],
    participants: [{ participant_type: "adult", count: 2 }],
    expected_total_cents: expected,
    ...extra,
  });

  it("refuses a made-up total", async () => {
    expectRaised(
      await receptionist.client.rpc("create_booking", { payload: payload(2) }),
      "Prices changed while you were booking",
    );
  });

  it("ignores made-up unit prices and charges from price_rules", async () => {
    const res = await receptionist.client.rpc("create_booking", { payload: payload(300000) });
    expect(res.error).toBeNull();
    const id = (res.data as { booking_id: string }).booking_id;
    const booking = await service
      .from("bookings")
      .select("charged_total_cents, booking_items(unit_charged_cents)")
      .eq("id", id)
      .single();
    expect(booking.data).toEqual({ charged_total_cents: 300000, booking_items: [{ unit_charged_cents: 150000 }] });
  });

  it("refuses a discount above the receptionist cap", async () => {
    expectRaised(
      await receptionist.client.rpc("create_booking", {
        payload: payload(150000, { discount: { type: "percent", value: 5000, reason: "Friend" } }),
      }),
      "Reception can give at most",
    );
  });
});
