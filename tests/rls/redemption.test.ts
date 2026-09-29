import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createFixtures, service, signInAs } from "./harness";

// The redemption engine under real concurrency (WP-23): each call below is
// its own HTTP request and its own database connection, which pgTAP's single
// transaction cannot reproduce. The scans come from four tablets, as at the
// lunch queue: calls from one tablet already queue behind each other on its
// staff_devices row, so a single-device test would pass without the
// entitlement lock this is meant to prove.

type Session = Awaited<ReturnType<typeof signInAs>>;
let staff: Session, admin: Session;
let fx: Awaited<ReturnType<typeof createFixtures>>;
const secret = randomUUID();
let deviceIds: string[];

beforeAll(async () => {
  [staff, admin] = await Promise.all([signInAs("activity_staff"), signInAs("admin")]);
  fx = await createFixtures();
  const ticket = await service.from("tickets").insert({ booking_id: fx.todayBooking.id });
  if (ticket.error) throw ticket.error;
  const devices = await service
    .from("staff_devices")
    .insert(
      [1, 2, 3, 4].map((n) => ({
        label: `RLS engine tablet ${n} ${fx.tag}`,
        device_secret_hash: createHash("sha256").update(secret).digest("hex"),
      })),
    )
    .select();
  if (devices.error) throw devices.error;
  deviceIds = devices.data.map((d) => d.id);
});

async function entitlement(quantity: number): Promise<string> {
  const res = await service
    .from("booking_activities")
    .insert({ booking_id: fx.todayBooking.id, activity_id: fx.activity.id, quantity })
    .select()
    .single();
  if (res.error) throw res.error;
  return res.data.id;
}

const redeem = (bookingActivityId: string, { clientUuid = randomUUID(), device = 0 } = {}) =>
  staff.client.rpc("redeem_activity", {
    p_booking_activity_id: bookingActivityId,
    p_quantity: 1,
    p_client_uuid: clientUuid,
    p_device_id: deviceIds[device % deviceIds.length],
    p_device_secret: secret,
  });

async function redeemedTotal(bookingActivityId: string): Promise<number> {
  const res = await service
    .from("ticket_redemptions")
    .select("quantity_redeemed")
    .eq("booking_activity_id", bookingActivityId);
  if (res.error) throw res.error;
  return res.data.reduce((sum, r) => sum + r.quantity_redeemed, 0);
}

describe("redeem_activity under concurrency", () => {
  it("eight simultaneous scans of the last unit: exactly one succeeds, the rest get a readable message", async () => {
    const id = await entitlement(1);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => redeem(id, { device: i })));
    const succeeded = results.filter((r) => !r.error);
    expect(succeeded).toHaveLength(1);
    for (const r of results.filter((r) => r.error)) {
      expect(r.error?.code).toBe("P0001");
      expect(r.error?.message).toMatch(/^No .+ remaining on RLS-.+: all 1 have been redeemed\.$/);
    }
    expect(await redeemedTotal(id)).toBe(1);
  });

  it("the same client_uuid posted five times at once lands exactly once", async () => {
    const id = await entitlement(4);
    const clientUuid = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => redeem(id, { clientUuid, device: i })));
    expect(results.map((r) => r.error)).toEqual([null, null, null, null, null]);
    const ids = new Set(results.map((r) => (r.data as { redemption_id: string }).redemption_id));
    expect(ids.size).toBe(1);
    const fresh = results.filter((r) => (r.data as { already_applied: boolean }).already_applied === false);
    expect(fresh).toHaveLength(1);
    expect(await redeemedTotal(id)).toBe(1);
  });

  it("a deactivated device stops at once, whatever its session says", async () => {
    const id = await entitlement(2);
    expect((await redeem(id)).error).toBeNull();
    const off = await admin.client
      .from("staff_devices")
      .update({ is_active: false })
      .eq("id", deviceIds[0])
      .select("id");
    expect(off.data).toHaveLength(1);
    const after = await redeem(id);
    expect(after.error?.message).toBe("This device has been deactivated. Ask a supervisor.");
    await service.from("staff_devices").update({ is_active: true }).eq("id", deviceIds[0]);
  });
});
