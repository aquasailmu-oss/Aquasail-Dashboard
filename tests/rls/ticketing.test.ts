import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createFixtures, expectRefused, service, signInAs } from "./harness";

type Session = Awaited<ReturnType<typeof signInAs>>;
let admin: Session, accountant: Session, receptionist: Session, staff: Session, supervisor: Session;
let fx: Awaited<ReturnType<typeof createFixtures>>;
let entitlementId: string;
let redemptionId: string;
let deviceId: string;

beforeAll(async () => {
  [admin, accountant, receptionist, staff, supervisor] = await Promise.all([
    signInAs("admin"),
    signInAs("accountant"),
    signInAs("receptionist"),
    signInAs("activity_staff"),
    signInAs("activity_supervisor"),
  ]);
  fx = await createFixtures();
  const entitlement = await service
    .from("booking_activities")
    .insert({ booking_id: fx.todayBooking.id, activity_id: fx.activity.id, quantity: 4 })
    .select()
    .single();
  if (entitlement.error) throw entitlement.error;
  entitlementId = entitlement.data.id;
  const device = await service
    .from("staff_devices")
    .insert({ label: `RLS tablet ${fx.tag}`, device_secret_hash: "x" })
    .select()
    .single();
  if (device.error) throw device.error;
  deviceId = device.data.id;
  const redemption = await service
    .from("ticket_redemptions")
    .insert({
      booking_id: fx.todayBooking.id,
      booking_activity_id: entitlementId,
      activity_id: fx.activity.id,
      quantity_redeemed: 1,
      client_uuid: randomUUID(),
      device_id: deviceId,
    })
    .select()
    .single();
  if (redemption.error) throw redemption.error;
  redemptionId = redemption.data.id;
  await service.from("message_log").insert({ booking_id: fx.todayBooking.id, channel: "email", to_address: "x@y.z" });
});

const redemptionRow = () => ({
  booking_id: fx.todayBooking.id,
  booking_activity_id: entitlementId,
  activity_id: fx.activity.id,
  quantity_redeemed: 1,
  client_uuid: randomUUID(),
});

describe.each(["activity_staff", "activity_supervisor"] as const)("%s", (role) => {
  const session = () => (role === "activity_staff" ? staff : supervisor);

  it.each([
    "bookings",
    "booking_items",
    "booking_activities",
    "payments",
    "clients",
    "price_rules",
    "tour_operators",
    "tickets",
    "ticket_redemptions",
    "message_log",
    "staff_devices",
    "audit_logs",
  ] as const)("reads nothing from %s", async (table) => {
    expectRefused(await session().client.from(table).select("*"));
  });

  it("reads the locations", async () => {
    const res = await session().client.from("locations").select("code");
    expect(res.data?.map((l) => l.code)).toEqual(expect.arrayContaining(["RECEPTION", "ISLAND", "JETTY"]));
  });

  it("cannot write a redemption, a message, a device or a location directly", async () => {
    expectRefused(await session().client.from("ticket_redemptions").insert(redemptionRow()).select());
    expectRefused(
      await session().client.from("message_log").insert({ booking_id: fx.todayBooking.id, channel: "email" }).select(),
    );
    expectRefused(
      await session().client.from("staff_devices").insert({ label: "Rogue", device_secret_hash: "x" }).select(),
    );
    expectRefused(
      await session().client.from("staff_devices").update({ is_active: false }).eq("id", deviceId).select(),
    );
    expectRefused(
      await session()
        .client.from("locations")
        .insert({ code: `X${fx.tag}`, name: "X", location_type: "island" })
        .select(),
    );
  });

  it("cannot check a party in by editing the booking", async () => {
    expectRefused(
      await session()
        .client.from("bookings")
        .update({ checked_in_at: new Date().toISOString() })
        .eq("id", fx.todayBooking.id)
        .select(),
    );
  });
});

describe("office staff", () => {
  it.each(["admin", "accountant", "receptionist"] as const)(
    "%s reads redemptions and the message log",
    async (role) => {
      const { client } = { admin, accountant, receptionist }[role];
      const redemptions = await client.from("ticket_redemptions").select("id").eq("id", redemptionId);
      expect(redemptions.data).toHaveLength(1);
      const messages = await client.from("message_log").select("id").eq("booking_id", fx.todayBooking.id);
      expect(messages.data?.length).toBeGreaterThan(0);
    },
  );

  it.each(["admin", "receptionist"] as const)(
    "%s cannot write, change or delete a redemption directly",
    async (role) => {
      const { client } = { admin, receptionist }[role];
      expectRefused(await client.from("ticket_redemptions").insert(redemptionRow()).select());
      expectRefused(
        await client.from("ticket_redemptions").update({ quantity_redeemed: 4 }).eq("id", redemptionId).select(),
      );
      expectRefused(await client.from("ticket_redemptions").delete().eq("id", redemptionId).select());
      const after = await service
        .from("ticket_redemptions")
        .select("quantity_redeemed")
        .eq("id", redemptionId)
        .single();
      expect(after.data?.quantity_redeemed).toBe(1);
    },
  );

  it("reception cannot set check-in or revoke a ticket by editing columns", async () => {
    expectRefused(
      await receptionist.client
        .from("bookings")
        .update({ checked_in_at: new Date().toISOString() })
        .eq("id", fx.todayBooking.id)
        .select(),
    );
    expectRefused(
      await receptionist.client
        .from("tickets")
        .update({ revoked_at: new Date().toISOString(), revoke_reason: "x" })
        .eq("booking_id", fx.todayBooking.id)
        .select(),
    );
  });

  it("nobody reads a device's secret hash, not even an admin", async () => {
    expectRefused(await admin.client.from("staff_devices").select("device_secret_hash"));
    const listed = await admin.client.from("staff_devices").select("id, label").eq("id", deviceId);
    expect(listed.data).toHaveLength(1);
  });

  it("only an admin deactivates a device by hand", async () => {
    expectRefused(
      await accountant.client.from("staff_devices").update({ is_active: false }).eq("id", deviceId).select(),
    );
    const res = await admin.client.from("staff_devices").update({ is_active: false }).eq("id", deviceId).select("id");
    expect(res.data).toHaveLength(1);
  });
});
