import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditAction, AuditData } from "@/lib/audit";
import type { Database } from "@/lib/database.types";

export type AuditRow = {
  id: number;
  table_name: string;
  record_id: string | null;
  action: AuditAction;
  actor_id: string | null;
  actor_role: string | null;
  changed_at: string;
  old_data: AuditData;
  new_data: AuditData;
};

/** Names for the people, booking references and catalogue items mentioned in a page of audit rows. */
export async function resolveAuditNames(supabase: SupabaseClient<Database>, rows: AuditRow[]) {
  const field = (r: AuditRow, k: string) => ((r.new_data ?? r.old_data ?? {}) as Record<string, unknown>)[k];
  const ids = (xs: unknown[]) => [...new Set(xs.filter((x): x is string => typeof x === "string"))];
  const actorIds = ids(rows.map((r) => r.actor_id));
  const bookingIds = ids(rows.map((r) => (r.table_name === "bookings" ? r.record_id : field(r, "booking_id"))));
  const packageIds = ids(rows.map((r) => field(r, "package_id")));
  const activityIds = ids(rows.map((r) => field(r, "activity_id")));
  const operatorIds = ids(rows.map((r) => field(r, "operator_id")));

  const [staff, bookings, packages, activities, operators] = await Promise.all([
    actorIds.length ? supabase.rpc("staff_names", { p_ids: actorIds }) : { data: [] },
    bookingIds.length ? supabase.from("bookings").select("id, reference").in("id", bookingIds) : { data: [] },
    packageIds.length ? supabase.from("packages").select("id, name").in("id", packageIds) : { data: [] },
    activityIds.length ? supabase.from("activities").select("id, name").in("id", activityIds) : { data: [] },
    operatorIds.length ? supabase.from("tour_operators").select("id, name").in("id", operatorIds) : { data: [] },
  ]);
  const actors = new Map((staff.data ?? []).map((s) => [s.id, s.full_name]));
  const references = new Map((bookings.data ?? []).map((b) => [b.id, b.reference]));
  const items = new Map([...(packages.data ?? []), ...(activities.data ?? [])].map((x) => [x.id, x.name]));
  const operatorNames = new Map((operators.data ?? []).map((o) => [o.id, o.name]));

  return {
    actor: (r: AuditRow) => (r.actor_id ? (actors.get(r.actor_id) ?? "Unknown user") : "System / setup"),
    booking: (r: AuditRow) => {
      const id = r.table_name === "bookings" ? r.record_id : field(r, "booking_id");
      return typeof id === "string" ? { id, reference: references.get(id) ?? null } : null;
    },
    names: (r: AuditRow) => {
      const item = field(r, "package_id") ?? field(r, "activity_id");
      const operator = field(r, "operator_id");
      return {
        item: typeof item === "string" ? items.get(item) : undefined,
        operator: typeof operator === "string" ? operatorNames.get(operator) : undefined,
      };
    },
  };
}
