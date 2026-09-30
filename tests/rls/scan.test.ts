import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { anon, createFixtures, expectRaised, service, signInAs } from "./harness";

// WP-24: scan_ticket() is the only way island roles see a booking. These
// attacks go through the public API as the real roles. The payload is
// searched as serialised text, so a column added to it later fails here
// rather than leaking quietly.

type Session = Awaited<ReturnType<typeof signInAs>>;
let staff: Session, supervisor: Session, accountant: Session;
let fx: Awaited<ReturnType<typeof createFixtures>>;
const secret = randomUUID();
let deviceId: string;
let token: string;

const FORBIDDEN = ["cents", "price", "total", "commission", "operator", "email", "phone"];

beforeAll(async () => {
  [staff, supervisor, accountant] = await Promise.all([
    signInAs("activity_staff"),
    signInAs("activity_supervisor"),
    signInAs("accountant"),
  ]);
  fx = await createFixtures();
  await service
    .from("clients")
    .update({ email: `scan-${fx.tag}@example.com` })
    .eq("id", fx.client.id);
  await service
    .from("bookings")
    .update({ notes: "Pays cash; VIP", meeting_point: "Jetty 2" })
    .eq("id", fx.todayBooking.id);
  const entitlement = await service
    .from("booking_activities")
    .insert({ booking_id: fx.todayBooking.id, activity_id: fx.activity.id, quantity: 2 });
  if (entitlement.error) throw entitlement.error;
  const ticket = await service.from("tickets").insert({ booking_id: fx.todayBooking.id }).select().single();
  if (ticket.error) throw ticket.error;
  token = ticket.data.token;
  const device = await service
    .from("staff_devices")
    .insert({
      label: `RLS scan tablet ${fx.tag}`,
      device_secret_hash: createHash("sha256").update(secret).digest("hex"),
    })
    .select()
    .single();
  if (device.error) throw device.error;
  deviceId = device.data.id;
});

describe.each(["activity_staff", "activity_supervisor"] as const)("scan_ticket as %s", (role) => {
  const session = () => (role === "activity_staff" ? staff : supervisor);

  it("returns the verdict and the entitlements", async () => {
    const res = await session().client.rpc("scan_ticket", {
      p_token: token,
      p_device_id: deviceId,
      p_device_secret: secret,
    });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ verdict: "VALID", reference: fx.todayBooking.reference });
  });

  it("carries no money, operator or contact details, however they are spelled", async () => {
    const res = await session().client.rpc("scan_ticket", {
      p_token: token,
      p_device_id: deviceId,
      p_device_secret: secret,
    });
    const text = JSON.stringify(res.data).toLowerCase();
    for (const word of FORBIDDEN) expect(text, `the payload mentions "${word}"`).not.toContain(word);
    expect(text).not.toContain(fx.client.phone_e164 ?? "no phone");
    expect(text).not.toContain(`scan-${fx.tag}`);
    expect(text).not.toContain("vip");
    expect(text).not.toContain("150000");
  });
});

describe("manual reference entry", () => {
  it("answers as the scan does, and carries nothing forbidden either", async () => {
    const res = await staff.client.rpc("scan_reference", {
      p_reference: fx.todayBooking.reference,
      p_device_id: deviceId,
      p_device_secret: secret,
    });
    expect(res.error).toBeNull();
    const text = JSON.stringify(res.data).toLowerCase();
    for (const word of FORBIDDEN) expect(text, `the payload mentions "${word}"`).not.toContain(word);
  });

  it("island staff cannot register a device; anonymous callers cannot reach any of it", async () => {
    expectRaised(
      await staff.client.rpc("register_device", { p_label: "Rogue", p_location_id: deviceId }),
      "Only a supervisor or an admin can register a device.",
    );
    for (const res of [
      await anon.rpc("register_device", { p_label: "Rogue", p_location_id: deviceId }),
      await anon.rpc("scan_reference", { p_reference: fx.todayBooking.reference }),
      await anon.rpc("device_info", { p_device_id: deviceId, p_device_secret: secret }),
    ]) {
      expect(res.error?.code).toBe("42501");
    }
  });
});

describe("who may scan", () => {
  it("an accountant may not", async () => {
    expectRaised(await accountant.client.rpc("scan_ticket", { p_token: token }), "Your role cannot scan tickets.");
  });

  it("anonymous callers may not", async () => {
    const res = await anon.rpc("scan_ticket", { p_token: token });
    expect(res.error?.code).toBe("42501");
  });
});
