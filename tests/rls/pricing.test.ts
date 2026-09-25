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

const change = () => [
  {
    scope: "activity",
    activity_id: fx.activity.id,
    audience: "walk_in",
    participant_type: "adult",
    retail_cents: 1,
    effective_from: "2099-06-01",
  },
];

describe("set_prices_bulk", () => {
  it("is refused for every role but admin", async () => {
    for (const { client } of [accountant, receptionist, staff]) {
      expectRaised(await client.rpc("set_prices_bulk", { changes: change() }), "Only an admin can change prices.");
    }
    expectRefused(await anon.rpc("set_prices_bulk", { changes: change() }));
  });
});

describe("price_rule_history", () => {
  it("is readable by admins and accountants only", async () => {
    for (const { client } of [admin, accountant]) {
      const res = await client.rpc("price_rule_history", { p_activity_id: fx.activity.id });
      expect(res.error).toBeNull();
      expect(res.data?.length).toBeGreaterThan(0);
    }
    for (const { client } of [receptionist, staff]) {
      expectRaised(
        await client.rpc("price_rule_history", { p_activity_id: fx.activity.id }),
        "Only admins and accountants",
      );
    }
    expectRefused(await anon.rpc("price_rule_history", { p_activity_id: fx.activity.id }));
  });
});
