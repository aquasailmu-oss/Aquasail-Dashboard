import { beforeAll, describe, expect, it } from "vitest";
import {
  ALL_TABLES,
  anon,
  createFixtures,
  expectRaised,
  expectRefused,
  service,
  signInAs,
  type TableName,
} from "./harness";

type Session = Awaited<ReturnType<typeof signInAs>>;
let admin: Session, accountant: Session, receptionist: Session, staff: Session, inactive: Session;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  [admin, accountant, receptionist, staff, inactive] = await Promise.all([
    signInAs("admin"),
    signInAs("accountant"),
    signInAs("receptionist"),
    signInAs("activity_staff"),
    signInAs("receptionist", { active: false }),
  ]);
  fx = await createFixtures();
});

const setPriceArgs = () => ({
  p_scope: "activity",
  p_activity_id: fx.activity.id,
  p_audience: "walk_in" as const,
  p_participant_type: "adult" as const,
  p_retail_cents: 1,
  p_effective_from: "2099-01-01",
});

describe("receptionist", () => {
  it("reads no price rules", async () => {
    expectRefused(await receptionist.client.from("price_rules").select("*"));
  });

  it("cannot update a price rule", async () => {
    expectRefused(
      await receptionist.client.from("price_rules").update({ retail_cents: 1 }).eq("id", fx.price.id).select(),
    );
    const after = await service.from("price_rules").select("retail_cents").eq("id", fx.price.id).single();
    expect(after.data?.retail_cents).toBe(150000);
  });

  it("cannot call set_price()", async () => {
    expectRaised(await receptionist.client.rpc("set_price", setPriceArgs()), "Only an admin can change prices.");
  });

  it("cannot update yesterday's booking", async () => {
    expectRefused(
      await receptionist.client.from("bookings").update({ notes: "tampered" }).eq("id", fx.pastBooking.id).select(),
    );
    const after = await service.from("bookings").select("notes").eq("id", fx.pastBooking.id).single();
    expect(after.data?.notes).toBeNull();
  });

  it("can update today's booking, but not its totals", async () => {
    const ok = await receptionist.client
      .from("bookings")
      .update({ notes: "window seat" })
      .eq("id", fx.todayBooking.id)
      .select();
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);
    expectRefused(
      await receptionist.client
        .from("bookings")
        .update({ charged_total_cents: 1 })
        .eq("id", fx.todayBooking.id)
        .select(),
    );
  });

  it.each([
    ["payments", () => fx.payment.id],
    ["bookings", () => fx.todayBooking.id],
    ["clients", () => fx.client.id],
  ] as const)("cannot delete from %s", async (table, id) => {
    expectRefused(await receptionist.client.from(table).delete().eq("id", id()).select());
    const still = await service.from(table).select("id").eq("id", id());
    expect(still.data).toHaveLength(1);
  });

  it("cannot edit or backdate a payment", async () => {
    expectRefused(
      await receptionist.client.from("payments").update({ amount_cents: 1 }).eq("id", fx.payment.id).select(),
    );
    expectRefused(
      await receptionist.client
        .from("payments")
        .insert({
          booking_id: fx.todayBooking.id,
          amount_cents: 100,
          method: "cash",
          received_from: "client",
          received_at: "2020-01-01T00:00:00Z",
        })
        .select(),
    );
  });

  it("cannot read the audit log", async () => {
    expectRefused(await receptionist.client.from("audit_logs").select("*"));
  });

  it("cannot call the reference counter directly", async () => {
    expectRefused(await receptionist.client.rpc("next_booking_reference", { p_service_date: fx.today }));
  });
});

describe("activity_staff", () => {
  it.each(["bookings", "payments", "clients", "booking_items", "tour_operators", "price_rules", "tickets"] as const)(
    "reads nothing from %s",
    async (table) => {
      expectRefused(await staff.client.from(table).select("*"));
    },
  );
});

describe("accountant", () => {
  it("cannot insert a booking", async () => {
    expectRefused(
      await accountant.client
        .from("bookings")
        .insert({ reference: `ACC-${fx.tag}`, client_id: fx.client.id, source_type: "walk_in", service_date: fx.today })
        .select(),
    );
    expectRaised(
      await accountant.client.rpc("create_booking", { payload: { idempotency_key: `acc-${fx.tag}` } }),
      "Only reception or an admin can create bookings.",
    );
  });

  it("cannot insert a payment", async () => {
    expectRefused(
      await accountant.client
        .from("payments")
        .insert({ booking_id: fx.todayBooking.id, amount_cents: 100, method: "cash", received_from: "client" })
        .select(),
    );
  });

  it("cannot call set_price()", async () => {
    expectRaised(await accountant.client.rpc("set_price", setPriceArgs()), "Only an admin can change prices.");
  });

  it("reads prices and the audit log", async () => {
    const prices = await accountant.client.from("price_rules").select("id").eq("id", fx.price.id);
    expect(prices.data).toHaveLength(1);
    const audit = await accountant.client.from("audit_logs").select("id").eq("record_id", fx.todayBooking.id);
    expect(audit.data?.length).toBeGreaterThan(0);
  });
});

describe("profiles", () => {
  it.each(["receptionist", "accountant", "activity_staff"] as const)(
    "a %s cannot change their own role",
    async (role) => {
      const session = { receptionist, accountant, activity_staff: staff }[role];
      const res = await session.client.from("profiles").update({ role: "admin" }).eq("id", session.userId).select();
      expect(res.error?.message).toBe("Only an admin can change a user's role.");
      const after = await service.from("profiles").select("role").eq("id", session.userId).single();
      expect(after.data?.role).toBe(role);
    },
  );

  it("a non-admin reads only their own profile", async () => {
    const res = await receptionist.client.from("profiles").select("id");
    expect(res.data?.map((p) => p.id)).toEqual([receptionist.userId]);
  });
});

describe("audit_logs", () => {
  it.each(["admin", "accountant", "receptionist"] as const)("cannot be updated or deleted by %s", async (role) => {
    const { client } = { admin, accountant, receptionist }[role];
    expectRefused(await client.from("audit_logs").update({ action: "DELETE" }).gte("id", 0).select());
    expectRefused(await client.from("audit_logs").delete().gte("id", 0).select());
    expectRefused(await client.from("audit_logs").insert({ table_name: "bookings", action: "INSERT" }).select());
  });

  it("names the actor of a change", async () => {
    await admin.client
      .from("bookings")
      .update({ notes: `audited ${fx.tag}` })
      .eq("id", fx.todayBooking.id);
    const log = await service
      .from("audit_logs")
      .select("actor_id, actor_role")
      .eq("table_name", "bookings")
      .eq("record_id", fx.todayBooking.id)
      .eq("action", "UPDATE")
      .order("id", { ascending: false })
      .limit(1)
      .single();
    expect(log.data).toEqual({ actor_id: admin.userId, actor_role: "admin" });
  });
});

describe("an inactive profile", () => {
  it.each(ALL_TABLES.filter((t) => t !== "profiles"))("reads nothing from %s", async (table: TableName) => {
    expectRefused(await inactive.client.from(table).select("*"));
  });

  it("sees only its own (inactive) profile, and cannot edit it", async () => {
    const res = await inactive.client.from("profiles").select("id, is_active");
    expect(res.data).toEqual([{ id: inactive.userId, is_active: false }]);
    expectRefused(await inactive.client.from("profiles").update({ full_name: "x" }).eq("id", inactive.userId).select());
  });

  it("cannot write anything", async () => {
    expectRefused(
      await inactive.client
        .from("payments")
        .insert({ booking_id: fx.todayBooking.id, amount_cents: 100, method: "cash", received_from: "client" })
        .select(),
    );
    expectRefused(await inactive.client.from("clients").insert({ first_name: "No", last_name: "Access" }).select());
    expectRaised(
      await inactive.client.rpc("create_booking", { payload: { idempotency_key: `inactive-${fx.tag}` } }),
      "Only reception or an admin can create bookings.",
    );
  });

  it("gets no role claim in a fresh token", async () => {
    const { data } = await inactive.client.auth.refreshSession();
    const token = data.session?.access_token ?? "";
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
    expect(claims.user_role).toBeUndefined();
  });
});

describe("anonymous", () => {
  it.each(ALL_TABLES)("reads nothing from %s", async (table: TableName) => {
    expectRefused(await anon.from(table).select("*"));
  });
});

describe("booking references", () => {
  it("stay unique under 50 concurrent requests", async () => {
    const date = "2099-12-31";
    const before = await service.from("booking_sequences").select("last_number").eq("service_date", date).maybeSingle();
    const start = before.data?.last_number ?? 0;
    const results = await Promise.all(
      Array.from({ length: 50 }, () => service.rpc("next_booking_reference", { p_service_date: date })),
    );
    expect(results.filter((r) => r.error)).toEqual([]);
    const refs = results.map((r) => r.data);
    expect(new Set(refs).size).toBe(50);
    const after = await service.from("booking_sequences").select("last_number").eq("service_date", date).single();
    expect(after.data?.last_number).toBe(start + 50);
  });
});
