"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { friendlyDbError } from "@/lib/db-errors";
import { parsePercent } from "@/lib/operators";
import { normalizePhone } from "@/lib/phone";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const ADMIN = ["admin"] as const;
const MAX_OPERATOR_LOGO_BYTES = 1_048_576;
const OPERATOR_LOGO_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

const operatorSchema = z.object({
  name: z.string().trim().min(1, "Give the operator a name.").max(120, "Keep the name under 120 characters."),
  contact_name: z.string().trim().max(120, "Keep the contact name under 120 characters."),
  contact_phone: z.string().trim().max(40, "That phone number is too long."),
  contact_email: z.union([
    z.literal(""),
    z.email("Enter a valid contact email, or leave it empty.").trim().toLowerCase(),
  ]),
  settlement_model: z.enum(["net_rate", "commission", "none"], { error: "Choose how this operator is settled." }),
  commission_percent: z.string().trim(),
  payer: z.enum(["client", "operator"], { error: "Choose who pays AquaSail." }),
  notes: z.string().trim().max(1000, "Keep the notes under 1,000 characters."),
});

export async function saveOperator(formData: FormData): Promise<Result<{ id: string }>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const parsed = operatorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const d = parsed.data;

  const logoEntry = formData.get("logo");
  const logoFile = logoEntry && typeof logoEntry !== "string" && logoEntry.size > 0 ? logoEntry : null;
  if (logoEntry && typeof logoEntry !== "string" && logoEntry.size > 0) {
    if (logoEntry.size > MAX_OPERATOR_LOGO_BYTES) return fail("The logo must be 1 MB or smaller.");
    if (!Object.hasOwn(OPERATOR_LOGO_TYPES, logoEntry.type)) {
      return fail("Use a PNG, JPEG or WebP image for the logo.");
    }
    const header = new Uint8Array(await logoEntry.slice(0, 12).arrayBuffer());
    const isPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => header[index] === byte);
    const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isWebp =
      String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
    if (!isPng && !isJpeg && !isWebp) return fail("That file does not appear to be a valid PNG, JPEG or WebP image.");
  }

  let rate: number | null = null;
  if (d.settlement_model === "commission") {
    const r = parsePercent(d.commission_percent);
    if (!r.ok) return r;
    rate = r.data;
  }
  let phone: string | null = null;
  if (d.contact_phone) {
    const normalized = normalizePhone(d.contact_phone);
    if (!normalized.ok) return fail(normalized.error);
    phone = normalized.e164;
  }
  const fields = {
    name: d.name,
    contact_name: d.contact_name || null,
    contact_phone: phone,
    contact_email: d.contact_email || null,
    settlement_model: d.settlement_model,
    default_commission_rate: rate,
    payer: d.payer,
    notes: d.notes || null,
  };

  const supabase = await createClient();
  async function uploadLogo(id: string): Promise<Result<string | null>> {
    if (!logoFile) return ok(null);
    const extension = OPERATOR_LOGO_TYPES[logoFile.type as keyof typeof OPERATOR_LOGO_TYPES];
    const path = `${id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("operator-logos").upload(path, logoFile, {
      cacheControl: "31536000",
      contentType: logoFile.type,
      upsert: false,
    });
    if (error) return fail("The operator logo could not be uploaded. Try again.");
    return ok(path);
  }

  const id = formData.get("id");
  if (typeof id === "string" && id) {
    const { data: current, error: currentError } = await supabase
      .from("tour_operators")
      .select("logo_path")
      .eq("id", id)
      .maybeSingle();
    if (currentError) return fail(friendlyDbError(currentError, "The operator could not be saved. Try again."));
    if (!current) return fail("That operator no longer exists.");

    const logoPath = await uploadLogo(id);
    if (!logoPath.ok) return logoPath;
    const { data, error } = await supabase
      .from("tour_operators")
      .update({ ...fields, ...(logoPath.data ? { logo_path: logoPath.data } : {}) })
      .eq("id", id)
      .select("id");
    if (error || !data?.length) {
      if (logoPath.data) await supabase.storage.from("operator-logos").remove([logoPath.data]);
      if (error) return fail(friendlyDbError(error, "The operator could not be saved. Try again."));
      return fail("That operator no longer exists.");
    }
    if (logoPath.data && current.logo_path) await supabase.storage.from("operator-logos").remove([current.logo_path]);
    revalidatePath("/admin/operators");
    revalidatePath(`/admin/operators/${id}`);
    revalidatePath("/bookings/new");
    return ok({ id });
  }

  const code = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,30}$/, "Use a code of 2 to 30 capital letters, digits or underscores, e.g. VERANDA.")
    .safeParse(formData.get("code"));
  if (!code.success) return fail(code.error.issues[0]?.message ?? "Check the code.");
  const newId = crypto.randomUUID();
  const logoPath = await uploadLogo(newId);
  if (!logoPath.ok) return logoPath;
  const { data, error } = await supabase
    .from("tour_operators")
    .insert({ ...fields, id: newId, code: code.data, logo_path: logoPath.data })
    .select("id")
    .single();
  if (error) {
    if (logoPath.data) await supabase.storage.from("operator-logos").remove([logoPath.data]);
    if (error.code === "23505") return fail(`An operator with the code ${code.data} already exists.`);
    return fail(friendlyDbError(error, "The operator could not be saved. Try again."));
  }
  revalidatePath("/admin/operators");
  revalidatePath("/bookings/new");
  return ok({ id: data.id });
}

export async function setOperatorActive(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const parsed = z
    .object({ id: z.uuid(), is_active: z.enum(["true", "false"]).transform((v) => v === "true") })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("That operator could not be found.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("tour_operators")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);
  if (error) return fail(friendlyDbError(error, "The change could not be saved. Try again."));
  revalidatePath("/admin/operators");
  revalidatePath(`/admin/operators/${parsed.data.id}`);
  revalidatePath("/bookings/new");
  return ok(null);
}
