import { beforeAll, describe, expect, it } from "vitest";
import { ALL_VIEWS, anon, createFixtures, expectRefused, signInAs, type ViewName } from "./harness";

type Session = Awaited<ReturnType<typeof signInAs>>;
let receptionist: Session, accountant: Session, staff: Session, inactive: Session;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  [receptionist, accountant, staff, inactive] = await Promise.all([
    signInAs("receptionist"),
    signInAs("accountant"),
    signInAs("activity_staff"),
    signInAs("receptionist", { active: false }),
  ]);
  fx = await createFixtures();
});

describe("client views and lookups", () => {
  it.each(ALL_VIEWS)("%s shows nothing to activity staff, inactive users or anon", async (view: ViewName) => {
    for (const client of [staff.client, inactive.client, anon]) {
      expectRefused(await client.from(view).select("*"));
    }
  });

  it("office staff see client summaries", async () => {
    const res = await accountant.client.from("client_summaries").select("id, booking_count").eq("id", fx.client.id);
    expect(res.data).toEqual([{ id: fx.client.id, booking_count: 2 }]);
  });

  it("find_similar_clients returns nothing to activity staff", async () => {
    const res = await staff.client.rpc("find_similar_clients", { p_phone_e164: fx.client.phone_e164 ?? "" });
    expect(res.error).toBeNull();
    expect(res.data).toEqual([]);
  });

  it("find_similar_clients finds the client by phone for reception", async () => {
    const res = await receptionist.client.rpc("find_similar_clients", { p_phone_e164: fx.client.phone_e164 ?? "" });
    expect(res.data?.map((m) => [m.id, m.confidence])).toEqual([[fx.client.id, "high"]]);
  });

  it("only admins and reception can add notes", async () => {
    const ok = await receptionist.client.rpc("append_client_note", { p_client_id: fx.client.id, p_note: "RLS note" });
    expect(ok.error).toBeNull();
    for (const client of [accountant.client, staff.client, inactive.client]) {
      const res = await client.rpc("append_client_note", { p_client_id: fx.client.id, p_note: "x" });
      expect(res.error, "note must be refused").not.toBeNull();
    }
    expectRefused(await anon.rpc("append_client_note", { p_client_id: fx.client.id, p_note: "x" }));
  });
});
