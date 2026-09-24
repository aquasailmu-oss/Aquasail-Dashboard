import "server-only";
import { businessDate } from "@/lib/dates";
import { cents, type Cents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

/**
 * Today's walk-in adult retail price for activities and packages, for the
 * admin catalogue screens only (package preview, "no price" warnings).
 * Bookings are never priced from this; WP-14's pricing engine does that.
 * Reads price_rules, so it returns nothing for roles that cannot.
 */
export async function walkInAdultPricesToday(): Promise<{
  activities: Map<string, Cents>;
  packages: Map<string, Cents>;
}> {
  const today = businessDate();
  const supabase = await createClient();
  const { data } = await supabase
    .from("price_rules")
    .select("activity_id, package_id, retail_cents")
    .eq("audience", "walk_in")
    .eq("participant_type", "adult")
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gt.${today}`);

  const activities = new Map<string, Cents>();
  const packages = new Map<string, Cents>();
  for (const rule of data ?? []) {
    if (rule.activity_id) activities.set(rule.activity_id, cents(rule.retail_cents));
    if (rule.package_id) packages.set(rule.package_id, cents(rule.retail_cents));
  }
  return { activities, packages };
}
