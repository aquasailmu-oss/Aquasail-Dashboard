import { beforeAll, describe, expect, it } from "vitest";
import { anon, createFixtures, expectRaised, expectRefused, signInAs } from "./harness";

type Session = Awaited<ReturnType<typeof signInAs>>;
let admin: Session, accountant: Session, receptionist: Session, staff: Session;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  [admin, accountant, receptionist, staff] = await Promise.all([
    signInAs("admin"),
    signInAs("accountant"),
    signInAs("receptionist"),
    signInAs("activity_staff"),
  ]);
  fx = await createFixtures();
});

const payload = () => ({
  code: `RLS_P${fx.tag.toUpperCase()}`,
  name: "RLS package",
  pricing_mode: "components",
  activities: [{ activity_id: fx.activity.id, quantity_per_participant: 1, is_optional: false }],
});

describe("save_package", () => {
  it("is refused for every role but admin", async () => {
    for (const { client } of [accountant, receptionist, staff]) {
      expectRaised(await client.rpc("save_package", { payload: payload() }), "Only an admin can change packages.");
    }
    expectRefused(await anon.rpc("save_package", { payload: payload() }));
  });

  it("works for an admin", async () => {
    const res = await admin.client.rpc("save_package", { payload: payload() });
    expect(res.error).toBeNull();
    expect(res.data).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("catalogue codes", () => {
  it("cannot be changed, even by an admin", async () => {
    const res = await admin.client.from("activities").update({ code: "RENAMED" }).eq("id", fx.activity.id).select();
    expect(res.error?.message).toMatch(/cannot be changed/);
  });
});
