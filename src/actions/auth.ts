"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { landingPath, safeNextPath } from "@/lib/navigation";
import { requestOrigin } from "@/lib/origin";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

// Authentication actions run before there is a role to check; every other
// Server Action calls requireRole().

const signInSchema = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

/** Signs in and redirects to the role's landing page. Returns only on failure. */
export async function signIn(_prev: Result<never> | null, formData: FormData): Promise<Result<never>> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    if (error?.status && error.status >= 500) {
      return fail("The sign-in service did not respond. Check the internet connection and try again.");
    }
    return fail("Email or password is incorrect.");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return fail("Your account has been deactivated. Ask an admin to reactivate it.");
  }

  redirect(safeNextPath(parsed.data.next) ?? landingPath(profile.role));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const resetRequestSchema = z.object({ email: z.email("Enter a valid email address.").trim().toLowerCase() });

/** Emails a password-reset link. Always reports success, so it cannot be used to discover accounts. */
export async function requestPasswordReset(_prev: Result<string> | null, formData: FormData): Promise<Result<string>> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Enter a valid email address.");

  const supabase = await createClient();
  const origin = await requestOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset`,
  });
  if (error?.status && error.status >= 500) {
    return fail("The email could not be sent just now. Try again in a minute.");
  }
  return ok(`If ${parsed.data.email} has an account, a reset link is on its way. It expires in one hour.`);
}

const newPasswordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The two passwords do not match.", path: ["confirm"] });

/** Sets a new password for the user signed in by a reset or invite link. */
export async function updatePassword(_prev: Result<never> | null, formData: FormData): Promise<Result<never>> {
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("This link has expired. Request a new one from the sign-in page.");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return fail("Choose a password you have not used here before.");
    if (error.code === "weak_password") return fail("That password is too easy to guess. Choose a longer one.");
    return fail("The password could not be changed. Try again.");
  }
  redirect("/");
}
