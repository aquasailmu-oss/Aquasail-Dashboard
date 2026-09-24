import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { service } from "./harness";

// The auth service creates users the same way for a self-signup and for the
// admin API's createUser (no invite): neither may choose its own role.
describe("new accounts", () => {
  it("an account that was not invited cannot choose its role and starts inactive", async () => {
    const email = `rls-selfsignup-${randomUUID().slice(0, 8)}@aquasail.test`;
    const created = await service.auth.admin.createUser({
      email,
      password: "rls-suite-password",
      email_confirm: true,
      user_metadata: { role: "admin", full_name: "Would-be Admin" },
    });
    expect(created.error).toBeNull();
    const profile = await service
      .from("profiles")
      .select("role, is_active")
      .eq("id", created.data.user?.id ?? "")
      .single();
    expect(profile.data).toEqual({ role: "receptionist", is_active: false });
  });

  it("an invited account gets the role the admin chose, active", async () => {
    const email = `rls-invite-${randomUUID().slice(0, 8)}@aquasail.test`;
    const invited = await service.auth.admin.inviteUserByEmail(email, {
      data: { role: "accountant", full_name: "Invited Accountant" },
    });
    expect(invited.error).toBeNull();
    const profile = await service
      .from("profiles")
      .select("role, is_active")
      .eq("id", invited.data.user?.id ?? "")
      .single();
    expect(profile.data).toEqual({ role: "accountant", is_active: true });
  });
});
