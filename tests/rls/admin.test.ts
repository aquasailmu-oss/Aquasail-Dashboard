import { beforeAll, describe, expect, it } from "vitest";
import { anon, expectRaised, expectRefused, service, signInAs } from "./harness";

type Session = Awaited<ReturnType<typeof signInAs>>;
let admin: Session, accountant: Session, receptionist: Session;

// A 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(async () => {
  [admin, accountant, receptionist] = await Promise.all([
    signInAs("admin"),
    signInAs("accountant"),
    signInAs("receptionist"),
  ]);
});

describe("user administration", () => {
  it("only an admin can list users (with emails)", async () => {
    const list = await admin.client.rpc("admin_list_users");
    expect(list.error).toBeNull();
    expect(list.data?.some((u) => u.email === "rls-receptionist@aquasail.test")).toBe(true);
    for (const { client } of [accountant, receptionist]) {
      expectRaised(await client.rpc("admin_list_users"), "Only an admin can list users.");
    }
    expectRefused(await anon.rpc("admin_list_users"));
  });

  it("an admin cannot deactivate or demote themselves", async () => {
    for (const change of [{ is_active: false }, { role: "receptionist" as const }]) {
      const res = await admin.client.from("profiles").update(change).eq("id", admin.userId).select();
      expect(res.error?.message).toBe("You cannot remove your own admin access. Ask another admin to do it.");
    }
    const after = await service.from("profiles").select("role, is_active").eq("id", admin.userId).single();
    expect(after.data).toEqual({ role: "admin", is_active: true });
  });
});

describe("app_settings", () => {
  it("only an admin can change settings", async () => {
    for (const { client } of [accountant, receptionist]) {
      expectRefused(
        await client.from("app_settings").upsert({ key: "max_discount_percent_receptionist", value: 100 }).select(),
      );
    }
    const res = await admin.client
      .from("app_settings")
      .upsert({ key: "rls_suite_probe", value: new Date().toISOString() })
      .select();
    expect(res.error).toBeNull();
  });
});

describe("branding storage", () => {
  it("only an admin can upload a logo", async () => {
    const name = `rls-${Date.now()}.png`;
    for (const client of [receptionist.client, accountant.client, anon]) {
      const res = await client.storage.from("branding").upload(name, PNG, { contentType: "image/png" });
      expect(res.error, "non-admin upload must fail").not.toBeNull();
    }
    const ok = await admin.client.storage.from("branding").upload(name, PNG, { contentType: "image/png" });
    expect(ok.error).toBeNull();
  });

  it("rejects file types other than PNG, JPEG and WebP", async () => {
    const res = await admin.client.storage
      .from("branding")
      .upload(`rls-${Date.now()}.svg`, Buffer.from("<svg/>"), { contentType: "image/svg+xml" });
    expect(res.error).not.toBeNull();
  });
});
