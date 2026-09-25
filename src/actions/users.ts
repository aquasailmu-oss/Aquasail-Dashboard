"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { friendlyDbError } from "@/lib/db-errors";
import { requestOrigin } from "@/lib/origin";
import { fail, ok, type Result } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const roleSchema = z.enum(["admin", "accountant", "receptionist", "activity_staff"], {
  error: "Choose a role.",
});

const inviteSchema = z.object({
  full_name: z.string().trim().min(1, "Enter the person's name.").max(120, "That name is too long."),
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  role: roleSchema,
});

/**
 * Creates the account and emails an invite link. The service-role client is
 * needed to create auth users; this action is admin-only and nothing else in
 * a request path uses that client.
 */
export async function inviteUser(formData: FormData): Promise<Result<string>> {
  const auth = await authorize(["admin"]);
  if (!auth.ok) return auth;

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const { full_name, email, role } = parsed.data;

  const origin = await requestOrigin();
  const { error } = await createAdminClient().auth.admin.inviteUserByEmail(email, {
    data: { full_name, role },
    redirectTo: `${origin}/auth/callback?next=/auth/reset`,
  });
  if (error) {
    if (error.code === "email_exists" || /already been registered/i.test(error.message)) {
      return fail(`${email} already has an account.`);
    }
    if (error.status === 429) return fail("Too many invites in a short time. Wait a minute and try again.");
    return fail("The invite could not be sent. Try again.");
  }

  revalidatePath("/admin/users");
  return ok(email);
}

const updateSchema = z.object({
  user_id: z.uuid(),
  full_name: z.string().trim().min(1, "Enter the person's name.").max(120, "That name is too long."),
  role: roleSchema,
  is_active: z.enum(["true", "false"]).transform((v) => v === "true"),
});

/** Renames a user, changes their role, or (de)activates them. */
export async function updateUser(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(["admin"]);
  if (!auth.ok) return auth;

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const { user_id, full_name, role, is_active } = parsed.data;

  // Also enforced by a trigger; checked here for a clear message first.
  if (user_id === auth.data.userId && (role !== "admin" || !is_active)) {
    return fail("You cannot remove your own admin access. Ask another admin to do it.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name, role, is_active })
    .eq("id", user_id)
    .select("id");
  if (error) return fail(friendlyDbError(error, "The change could not be saved. Try again."));
  if (!data?.length) return fail("That user no longer exists.");

  revalidatePath("/admin/users");
  return ok(null);
}
