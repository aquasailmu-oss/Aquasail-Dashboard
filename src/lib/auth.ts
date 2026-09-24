import "server-only";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type Role = Database["public"]["Enums"]["app_role"];

export type SessionUser = { userId: string; role: Role; fullName: string };

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  accountant: "Accountant",
  receptionist: "Receptionist",
  activity_staff: "Activity staff",
};

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
