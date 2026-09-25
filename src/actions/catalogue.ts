"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { walkInAdultPricesToday } from "@/lib/catalogue-prices";
import { friendlyDbError } from "@/lib/db-errors";
import { cents, type Cents } from "@/lib/money";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const ADMIN = ["admin"] as const;

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_]{2,30}$/, "Use a code of 2 to 30 capital letters, digits or underscores, e.g. PARASAIL.");

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

const activitySchema = z.object({
  name: z.string().trim().min(1, "Give the activity a name.").max(80, "Keep the name under 80 characters."),
  description: z.string().trim().max(500, "Keep the description under 500 characters."),
  is_redeemable: z.literal("on").optional(),
  default_duration_minutes: z.union([
    z.literal(""),
    z.coerce
      .number({ error: "Enter the duration in whole minutes." })
      .int("Enter the duration in whole minutes.")
      .min(1, "The duration must be at least 1 minute.")
      .max(1440, "The duration cannot be more than a day."),
  ]),
  sort_order: z.coerce.number({ error: "Enter a sort order number." }).int("Enter a whole number.").min(0).max(9999),
});

export async function saveActivity(formData: FormData): Promise<Result<{ id: string }>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const parsed = activitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const fields = {
    name: parsed.data.name,
    description: parsed.data.description || null,
    is_redeemable: parsed.data.is_redeemable === "on",
    default_duration_minutes: parsed.data.default_duration_minutes === "" ? null : parsed.data.default_duration_minutes,
    sort_order: parsed.data.sort_order,
  };

  const supabase = await createClient();
  const id = formData.get("id");
  if (typeof id === "string" && id) {
    const { data, error } = await supabase.from("activities").update(fields).eq("id", id).select("id");
    if (error) return fail(friendlyDbError(error, "The activity could not be saved. Try again."));
    if (!data?.length) return fail("That activity no longer exists.");
  } else {
    const code = codeSchema.safeParse(formData.get("code"));
    if (!code.success) return fail(code.error.issues[0]?.message ?? "Check the code.");
    const { data, error } = await supabase
      .from("activities")
      .insert({ ...fields, code: code.data })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return fail(`An activity with the code ${code.data} already exists.`);
      return fail(friendlyDbError(error, "The activity could not be saved. Try again."));
    }
    revalidatePath("/admin/activities");
    return ok({ id: data.id });
  }
  revalidatePath("/admin/activities");
  revalidatePath("/admin/packages");
  return ok({ id });
}

const activeSchema = z.object({ id: z.uuid(), is_active: z.enum(["true", "false"]).transform((v) => v === "true") });

export async function setActivityActive(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const parsed = activeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("That activity could not be found.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("activities")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);
  if (error) return fail(friendlyDbError(error, "The change could not be saved. Try again."));
  revalidatePath("/admin/activities");
  revalidatePath("/admin/packages");
  return ok(null);
}

const moveSchema = z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) });

/** Moves an activity one place up or down, renumbering the list in steps of 10. */
export async function moveActivity(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const parsed = moveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("That activity could not be found.");

  const supabase = await createClient();
  const { data: all, error } = await supabase
    .from("activities")
    .select("id, sort_order")
    .order("sort_order")
    .order("name");
  if (error || !all) return fail("The order could not be changed. Try again.");
  const order = all.map((a) => a.id);
  const at = order.indexOf(parsed.data.id);
  const to = parsed.data.direction === "up" ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= order.length) return ok(null);
  [order[at], order[to]] = [order[to], order[at]];

  const current = new Map(all.map((a) => [a.id, a.sort_order]));
  for (const [i, id] of order.entries()) {
    const sort_order = (i + 1) * 10;
    if (current.get(id) === sort_order) continue;
    const { error: e } = await supabase.from("activities").update({ sort_order }).eq("id", id);
    if (e) return fail(friendlyDbError(e, "The order could not be changed. Try again."));
  }
  revalidatePath("/admin/activities");
  return ok(null);
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

const packageLineSchema = z.object({
  activity_id: z.uuid(),
  quantity_per_participant: z.number().int().min(1, "Each activity needs a quantity of at least 1.").max(20),
  is_optional: z.boolean(),
});

const packageSchema = z.object({
  id: z.uuid().optional(),
  code: z.string().optional(),
  name: z.string().trim().min(1, "Give the package a name.").max(80, "Keep the name under 80 characters."),
  description: z.string().trim().max(500, "Keep the description under 500 characters."),
  pricing_mode: z.enum(["bundle", "components"], { error: "Choose how the package is priced." }),
  is_active: z.boolean(),
  activities: z.array(packageLineSchema).min(1, "Add at least one activity to the package.").max(20),
});

export type PackageInput = z.input<typeof packageSchema>;

export type PackagePreview = {
  lines: { activity_id: string; quantity: number; is_optional: boolean; unit_cents: Cents | null }[];
  total_cents: Cents | null;
  missing: boolean;
};

/** What a walk-in adult would pay today for this composition (admin preview, not a quote). */
async function preview(input: Pick<PackageInput, "id" | "pricing_mode" | "activities">): Promise<PackagePreview> {
  const prices = await walkInAdultPricesToday();
  const lines = input.activities.map((l) => ({
    activity_id: l.activity_id,
    quantity: l.quantity_per_participant,
    is_optional: l.is_optional,
    unit_cents: prices.activities.get(l.activity_id) ?? null,
  }));
  if (input.pricing_mode === "bundle") {
    const own = input.id ? (prices.packages.get(input.id) ?? null) : null;
    return { lines, total_cents: own, missing: own === null };
  }
  const priced = lines.filter((l) => !l.is_optional);
  const missing = priced.some((l) => l.unit_cents === null);
  const total = missing ? null : cents(priced.reduce((sum, l) => sum + (l.unit_cents ?? 0) * l.quantity, 0));
  return { lines, total_cents: total, missing };
}

export async function previewPackage(
  input: Pick<PackageInput, "id" | "pricing_mode" | "activities">,
): Promise<Result<PackagePreview>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const parsed = packageSchema.pick({ id: true, pricing_mode: true, activities: true }).safeParse(input);
  if (!parsed.success) return ok({ lines: [], total_cents: null, missing: true });
  return ok(await preview(parsed.data));
}

/** Saves a package and its activities; warns (never blocks) when it has no price today. */
export async function savePackage(input: PackageInput): Promise<Result<{ id: string; warning: string | null }>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const parsed = packageSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the package and try again.");
  if (!parsed.data.id) {
    const code = codeSchema.safeParse(parsed.data.code ?? "");
    if (!code.success) return fail(code.error.issues[0]?.message ?? "Check the code.");
    parsed.data.code = code.data;
  }

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("save_package", { payload: parsed.data });
  if (error || !id)
    return fail(friendlyDbError(error ?? { code: "", message: "" }, "The package could not be saved. Try again."));

  const check = await preview({ ...parsed.data, id });
  const warning = check.missing
    ? parsed.data.pricing_mode === "bundle"
      ? "Saved, but this package has no walk-in adult price for today. Reception cannot sell it until one is set in Pricing."
      : "Saved, but some included activities have no walk-in adult price for today. Set them in Pricing."
    : null;

  revalidatePath("/admin/packages");
  revalidatePath("/admin/activities");
  return ok({ id, warning });
}

export async function setPackageActive(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const parsed = activeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("That package could not be found.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("packages")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.id);
  if (error) return fail(friendlyDbError(error, "The change could not be saved. Try again."));
  revalidatePath("/admin/packages");
  revalidatePath("/admin/activities");
  return ok(null);
}

/** Copies a package (inactive, code with a _2, _3... suffix) for a seasonal variant. */
export async function duplicatePackage(formData: FormData): Promise<Result<{ id: string }>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return fail("That package could not be found.");

  const supabase = await createClient();
  const { data: source } = await supabase
    .from("packages")
    .select(
      "code, name, description, pricing_mode, package_activities(activity_id, quantity_per_participant, is_optional, sort_order)",
    )
    .eq("id", id.data)
    .single();
  if (!source) return fail("That package could not be found.");

  const { data: taken } = await supabase.from("packages").select("code").like("code", `${source.code}%`);
  const used = new Set((taken ?? []).map((p) => p.code));
  let n = 2;
  while (used.has(`${source.code}_${n}`)) n++;
  const code = `${source.code}_${n}`.slice(0, 30);

  const { data: newId, error } = await supabase.rpc("save_package", {
    payload: {
      code,
      name: `${source.name} (copy)`,
      description: source.description,
      pricing_mode: source.pricing_mode,
      is_active: false,
      activities: [...source.package_activities]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(({ activity_id, quantity_per_participant, is_optional }) => ({
          activity_id,
          quantity_per_participant,
          is_optional,
        })),
    },
  });
  if (error || !newId)
    return fail(friendlyDbError(error ?? { code: "", message: "" }, "The package could not be copied."));
  revalidatePath("/admin/packages");
  return ok({ id: newId });
}
