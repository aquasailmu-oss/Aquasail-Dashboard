"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { addDays, businessDate, parseDateInput } from "@/lib/dates";
import { friendlyDbError } from "@/lib/db-errors";
import { cents, toCents, type Cents } from "@/lib/money";
import { parsePercent } from "@/lib/operators";
import { adjustPrice, parsePercentChange } from "@/lib/pricing/adjust";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const ADMIN = ["admin"] as const;
const participantType = z.enum(["adult", "child", "infant"]);

function rupees(value: string, label: string): Result<Cents> {
  try {
    const amount = toCents(value);
    return amount < 0 ? fail(`${label} cannot be negative.`) : ok(amount);
  } catch {
    return fail(`Enter the ${label.toLowerCase()} in rupees, e.g. 1850.`);
  }
}

function effectiveDate(value: string): Result<string> {
  const date = parseDateInput(value);
  if (!date) return fail("Choose the date the new price starts.");
  if (date < businessDate())
    return fail("A price cannot start in the past. Past bookings keep what they were charged.");
  return ok(date);
}

// ---------------------------------------------------------------------------
// One cell
// ---------------------------------------------------------------------------

const setPriceSchema = z.object({
  scope: z.enum(["activity", "package"]),
  target_id: z.uuid(),
  operator_id: z.uuid().nullable(),
  participant_type: participantType,
  retail: z.string(),
  net: z.string(),
  commission_percent: z.string(),
  effective_from: z.string(),
});

export async function setPrice(input: z.input<typeof setPriceSchema>): Promise<Result<null>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const parsed = setPriceSchema.safeParse(input);
  if (!parsed.success) return fail("Check the price and try again.");
  const d = parsed.data;

  const retail = rupees(d.retail, "Retail price");
  if (!retail.ok) return retail;
  let net: Cents | undefined;
  if (d.net.trim()) {
    if (!d.operator_id) return fail("Net prices only apply to operators.");
    const n = rupees(d.net, "Net price");
    if (!n.ok) return n;
    net = n.data;
  }
  let rate: number | undefined;
  if (d.commission_percent.trim()) {
    if (!d.operator_id) return fail("Commission only applies to operators.");
    const r = parsePercent(d.commission_percent);
    if (!r.ok) return r;
    rate = r.data;
  }
  const from = effectiveDate(d.effective_from);
  if (!from.ok) return from;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_price", {
    p_scope: d.scope,
    p_activity_id: d.scope === "activity" ? d.target_id : undefined,
    p_package_id: d.scope === "package" ? d.target_id : undefined,
    p_audience: d.operator_id ? "operator" : "walk_in",
    p_operator_id: d.operator_id ?? undefined,
    p_participant_type: d.participant_type,
    p_retail_cents: retail.data,
    p_net_cents: net,
    p_commission_rate: rate,
    p_effective_from: from.data,
  });
  if (error) return fail(friendlyDbError(error, "The price could not be saved. Try again."));
  revalidatePath("/admin/pricing", "layout");
  return ok(null);
}

// ---------------------------------------------------------------------------
// Bulk: a percentage across a whole column (one audience) or row (one item)
// ---------------------------------------------------------------------------

const bulkSchema = z.object({
  axis: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("column"), operator_id: z.uuid().nullable() }),
    z.object({ kind: z.literal("row"), scope: z.enum(["activity", "package"]), target_id: z.uuid() }),
  ]),
  participant_type: participantType,
  percent: z.string(),
  effective_from: z.string(),
});

export type BulkInput = z.input<typeof bulkSchema>;

export type BulkChange = {
  rule_id: string;
  item: string;
  audience: string;
  retail_from: Cents;
  retail_to: Cents;
  net_from: Cents | null;
  net_to: Cents | null;
};

export type BulkPreview = { changes: BulkChange[]; skipped: string[]; fingerprint: string };

type ChangeRow = { change: BulkChange; payload: Record<string, string | number | null> };

async function computeBulk(input: BulkInput): Promise<Result<{ rows: ChangeRow[]; skipped: string[] }>> {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return fail("Check the change and try again.");
  const d = parsed.data;
  const bp = parsePercentChange(d.percent);
  if (!bp.ok) return bp;
  const from = effectiveDate(d.effective_from);
  if (!from.ok) return from;
  const dayBefore = addDays(from.data, -1);

  const supabase = await createClient();
  let query = supabase
    .from("price_rules")
    .select(
      "id, scope, activity_id, package_id, audience, operator_id, retail_cents, net_cents, commission_rate, effective_from, effective_to, activities(name, is_active), packages(name, is_active, pricing_mode), tour_operators(name, is_active)",
    )
    .eq("participant_type", d.participant_type)
    .lte("effective_from", dayBefore)
    .or(`effective_to.is.null,effective_to.gt.${dayBefore}`);
  if (d.axis.kind === "column") {
    query = d.axis.operator_id
      ? query.eq("audience", "operator").eq("operator_id", d.axis.operator_id)
      : query.eq("audience", "walk_in");
  } else {
    query = query.eq(d.axis.scope === "activity" ? "activity_id" : "package_id", d.axis.target_id);
  }
  const { data: rules, error } = await query;
  if (error) return fail("The current prices could not be read. Try again.");

  const rows: ChangeRow[] = [];
  const skipped: string[] = [];
  for (const r of rules ?? []) {
    const item = r.activities?.name ?? r.packages?.name ?? "Unknown";
    const audience = r.audience === "walk_in" ? "Walk-in" : (r.tour_operators?.name ?? "Operator");
    const inactive =
      (r.activities && !r.activities.is_active) ||
      (r.packages && (!r.packages.is_active || r.packages.pricing_mode !== "bundle")) ||
      (r.tour_operators && !r.tour_operators.is_active);
    if (inactive) continue;
    if (r.effective_to !== null) {
      skipped.push(`${item}, ${audience}: a later price is already scheduled`);
      continue;
    }
    const retailTo = adjustPrice(cents(r.retail_cents), bp.data);
    const netTo = r.net_cents === null ? null : adjustPrice(cents(r.net_cents), bp.data);
    rows.push({
      change: {
        rule_id: r.id,
        item,
        audience,
        retail_from: cents(r.retail_cents),
        retail_to: retailTo,
        net_from: r.net_cents === null ? null : cents(r.net_cents),
        net_to: netTo,
      },
      payload: {
        scope: r.scope,
        activity_id: r.activity_id,
        package_id: r.package_id,
        audience: r.audience,
        operator_id: r.operator_id,
        participant_type: d.participant_type,
        retail_cents: retailTo,
        net_cents: netTo,
        commission_rate: r.commission_rate,
        effective_from: from.data,
      },
    });
  }
  rows.sort((a, b) => a.change.item.localeCompare(b.change.item) || a.change.audience.localeCompare(b.change.audience));
  return ok({ rows, skipped });
}

const fingerprintOf = (rows: ChangeRow[]) =>
  rows.map(({ change: c }) => `${c.rule_id}:${c.retail_to}:${c.net_to}`).join("|");

/** Every change a bulk adjustment would make. Nothing is written. */
export async function previewBulkChange(input: BulkInput): Promise<Result<BulkPreview>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const computed = await computeBulk(input);
  if (!computed.ok) return computed;
  const changes = computed.data.rows.map((r) => r.change);
  return ok({ changes, skipped: computed.data.skipped, fingerprint: fingerprintOf(computed.data.rows) });
}

/**
 * Applies a previewed bulk change. It is recomputed here and refused if it
 * no longer matches what the admin reviewed (someone changed a price since).
 */
export async function applyBulkChange(input: BulkInput & { fingerprint: string }): Promise<Result<number>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  if (!z.string().max(200_000).safeParse(input.fingerprint).success)
    return fail("Preview the change again before applying.");
  const computed = await computeBulk(input);
  if (!computed.ok) return computed;
  if (computed.data.rows.length === 0) return fail("There are no prices to change.");
  if (fingerprintOf(computed.data.rows) !== input.fingerprint) {
    return fail("Prices changed since you previewed this. Preview it again before applying.");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_prices_bulk", {
    changes: computed.data.rows.map((r) => r.payload),
  });
  if (error) return fail(friendlyDbError(error, "The prices could not be changed. Nothing was applied."));
  revalidatePath("/admin/pricing", "layout");
  return ok(data ?? computed.data.rows.length);
}

/** Withdraws a scheduled price that has not started and has no bookings in its dates. */
export async function withdrawScheduledPrice(ruleId: string): Promise<Result<null>> {
  const auth = await authorize(ADMIN);
  if (!auth.ok) return auth;
  const id = z.uuid().safeParse(ruleId);
  if (!id.success) return fail("That price no longer exists.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_scheduled_price", { p_rule_id: id.data });
  if (error) return fail(friendlyDbError(error, "The price could not be withdrawn. Try again."));
  revalidatePath("/admin/pricing", "layout");
  return ok(null);
}
