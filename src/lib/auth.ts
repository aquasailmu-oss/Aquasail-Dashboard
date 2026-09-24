import "server-only";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { fail, ok, type Result } from "@/lib/result";
import type { Role } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = { userId: string; role: Role; fullName: string };

/**
 * The signed-in user and their profile, once per request. The profile, not
 * the JWT claim, is authoritative: a role change or deactivation applies on
 * the next request rather than when the token expires.
 */
const loadSession = cache(async (): Promise<SessionUser | "signed_out" | "inactive"> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "signed_out";

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !profile.is_active) return "inactive";

  return { userId: user.id, role: profile.role, fullName: profile.full_name };
});

/** For pages: the current user, or a redirect to sign-in (or the deactivated notice). */
export async function requireUser(): Promise<SessionUser> {
  const session = await loadSession();
  if (session === "signed_out") redirect("/login");
  if (session === "inactive") redirect("/auth/deactivated");
  return session;
}

/** For pages: the current user if their role is allowed, otherwise a 403. */
export async function requireRole(roles: readonly Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) forbidden();
  return user;
}

/**
 * For Server Actions: the current user if their role is allowed, otherwise a
 * readable failure the form can show. An action never assumes that because
 * its page rendered, the caller is authorised.
 */
export async function authorize(roles: readonly Role[]): Promise<Result<SessionUser>> {
  const session = await loadSession();
  if (session === "signed_out") return fail("Your session has ended. Sign in again.");
  if (session === "inactive") return fail("Your account has been deactivated. Ask an admin to reactivate it.");
  if (!roles.includes(session.role)) return fail("Your role does not allow this.");
  return ok(session);
}
