"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { friendlyDbError } from "@/lib/db-errors";
import { fail, ok, type Result } from "@/lib/result";
import { getSettings, type SettingKey, type Settings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";

const optionalText = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);

const settingsSchema = z.object({
  company_name: z.string().trim().min(1, "Enter the company name.").max(120, "Keep this under 120 characters."),
  company_phone: optionalText(40),
  company_email: z.union([z.literal(""), z.email("Enter a valid company email, or leave it empty.")]),
  default_meeting_point: optionalText(200),
  ticket_footer_text: optionalText(500),
  currency_label: z.string().trim().min(1, "Enter a currency label, e.g. Rs.").max(8, "Keep the label short, e.g. Rs."),
  max_discount_percent_receptionist: z.coerce
    .number({ error: "Enter the discount limit as a whole number." })
    .int("Enter the discount limit as a whole number.")
    .min(0, "The discount limit cannot be negative.")
    .max(100, "The discount limit cannot be over 100%."),
});

async function writeSettings(changes: Partial<Settings>, userId: string): Promise<Result<null>> {
  const rows = Object.entries(changes).map(([key, value]) => ({ key, value: value as Json, updated_by: userId }));
  if (rows.length === 0) return ok(null);
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return fail(friendlyDbError(error, "The settings could not be saved. Try again."));
  revalidatePath("/", "layout");
  return ok(null);
}

/** Saves the settings form. Only changed keys are written, so the audit log shows real changes. */
export async function saveSettings(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(["admin"]);
  if (!auth.ok) return auth;

  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");

  const current = await getSettings();
  const changes: Partial<Settings> = {};
  for (const [key, value] of Object.entries(parsed.data) as [SettingKey, string | number][]) {
    if (current[key] !== value) (changes as Record<SettingKey, unknown>)[key] = value;
  }
  return writeSettings(changes, auth.data.userId);
}

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_LOGO_BYTES = 1024 * 1024;

/** Uploads a new logo. Each upload is a new file, so earlier logos stay retrievable. */
export async function uploadLogo(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(["admin"]);
  if (!auth.ok) return auth;

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return fail("Choose an image file to upload.");
  const ext = LOGO_TYPES[file.type];
  if (!ext) return fail("Use a PNG, JPEG or WebP image.");
  if (file.size > MAX_LOGO_BYTES) return fail("The logo must be under 1 MB.");

  const path = `logo-${Date.now()}.${ext}`;
  const supabase = await createClient();
  const { error } = await supabase.storage.from("branding").upload(path, file, { contentType: file.type });
  if (error) return fail("The logo could not be uploaded. Try again.");

  return writeSettings({ logo_path: path }, auth.data.userId);
}
