import { formatDateShort, formatDateTime, formatTime } from "@/lib/dates";
import { cents, formatRs } from "@/lib/money";
import { formatRate } from "@/lib/operators";

/**
 * Turning audit rows (old_data/new_data jsonb, written by audit_trigger())
 * into something an accountant can read: labelled fields, money formatted,
 * internal ids and bookkeeping columns hidden, and a one-line summary.
 */
export type AuditData = Record<string, unknown> | null;
export type AuditAction = "INSERT" | "UPDATE" | "DELETE";
export type FieldChange = { field: string; label: string; before: string; after: string };

const HIDDEN = new Set([
  "id",
  "token",
  "idempotency_key",
  "search_text",
  "created_at",
  "updated_at",
  "created_by",
  "recorded_by",
  "updated_by",
  "cancelled_by",
  "sort_order",
]);

const LABELS: Record<string, string> = {
  charged_total_cents: "Total charged",
  retail_total_cents: "Retail total",
  discount_total_cents: "Discount",
  operator_net_total_cents: "Operator net total",
  commission_total_cents: "Commission total",
  unit_retail_cents: "Unit retail price",
  unit_charged_cents: "Unit price charged",
  unit_operator_net_cents: "Unit operator net",
  amount_cents: "Amount",
  retail_cents: "Retail price",
  net_cents: "Net price",
  discount_cents: "Discount",
  commission_cents: "Commission",
  phone_e164: "Phone",
  is_active: "Active",
  is_correction: "Correction",
  is_redeemable: "Redeemed on the island",
  is_optional: "Optional",
  default_duration_minutes: "Usual duration (minutes)",
  quantity_per_participant: "Quantity per participant",
  printed_count: "Times printed",
  received_at: "Received",
  cancelled_at: "Cancelled at",
  effective_from: "Starts",
  effective_to: "Ends (exclusive)",
  full_name: "Name",
};

export function isHidden(field: string): boolean {
  return HIDDEN.has(field) || field.endsWith("_id");
}

export function fieldLabel(field: string): string {
  if (LABELS[field]) return LABELS[field];
  const words = field.replace(/_cents$/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field.endsWith("_cents") && typeof value === "number") return formatRs(cents(value));
  if (field.endsWith("commission_rate") && typeof value === "number") return formatRate(value);
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDateShort(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return formatTime(value);
    return value;
  }
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/** Changed fields for an update; every visible field for an insert or delete. */
export function diffFields(action: AuditAction, oldData: AuditData, newData: AuditData): FieldChange[] {
  const before = oldData ?? {};
  const after = newData ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !isHidden(k));
  return keys
    .filter((k) => {
      if (action === "UPDATE") return JSON.stringify(before[k]) !== JSON.stringify(after[k]);
      const v = action === "DELETE" ? before[k] : after[k];
      return v !== null && v !== undefined && v !== "" && v !== false;
    })
    .map((k) => ({
      field: k,
      label: fieldLabel(k),
      before: action === "INSERT" ? "" : formatValue(k, before[k]),
      after: action === "DELETE" ? "" : formatValue(k, after[k]),
    }));
}

const TABLES: Record<string, string> = {
  bookings: "Booking",
  booking_items: "Booking line",
  booking_participants: "Participants",
  booking_activities: "Entitlement",
  payments: "Payment",
  tickets: "Ticket",
  clients: "Client",
  activities: "Activity",
  packages: "Package",
  package_activities: "Package activity",
  tour_operators: "Tour operator",
  price_rules: "Price",
  profiles: "User",
  resources: "Boat",
  app_settings: "Setting",
};

export const tableLabel = (table: string) => TABLES[table] ?? table;
export const AUDITED_TABLES = Object.keys(TABLES);

/**
 * A one-line, human sentence for an audit entry. `names` resolves the ids the
 * row refers to: the package or activity, and the tour operator.
 */
export function describe(
  table: string,
  action: AuditAction,
  oldData: AuditData,
  newData: AuditData,
  names: { item?: string; operator?: string } = {},
): string {
  const itemName = names.item;
  const d = (newData ?? oldData ?? {}) as Record<string, unknown>;
  const money = (v: unknown) => (typeof v === "number" ? formatRs(cents(v)) : "");
  switch (table) {
    case "bookings":
      if (action === "INSERT")
        return `Booking created, ${money(d.charged_total_cents)} for ${formatValue("service_date", d.service_date)}`;
      if (action === "UPDATE" && oldData?.status !== "cancelled" && newData?.status === "cancelled") {
        return `Booking cancelled: ${String(newData?.cancellation_reason ?? "")}`;
      }
      return `Booking changed: ${diffFields(action, oldData, newData)
        .map((c) => c.label.toLowerCase())
        .join(", ")}`;
    case "booking_items": {
      const what = `${itemName ?? "line"} × ${String(d.quantity ?? "")} ${String(d.participant_type ?? "")}`;
      if (action === "INSERT") return `Line added: ${what} at ${money(d.unit_charged_cents)}`;
      if (action === "DELETE") return `Line removed: ${what}`;
      return `Line changed: ${what}`;
    }
    case "payments":
      if (d.is_correction) return `Payment corrected: ${money(d.amount_cents)} (${String(d.note ?? "")})`;
      return `Payment received: ${money(d.amount_cents)} by ${String(d.method ?? "").replace("_", " ")}`;
    case "price_rules": {
      const who = d.audience === "operator" ? (names.operator ?? "operator") : "walk-in";
      const what = `${itemName ?? "item"}, ${String(d.participant_type ?? "")}, ${who}`;
      if (action === "UPDATE" && oldData?.effective_to !== newData?.effective_to) {
        return `Price closed: ${what}: ${money(d.retail_cents)} ends ${newData?.effective_to ? formatValue("effective_to", newData.effective_to) : "never"}`;
      }
      if (action === "DELETE")
        return `Scheduled price withdrawn: ${what}: ${money(d.retail_cents)} from ${formatValue("effective_from", d.effective_from)}`;
      return `Price set: ${what}: ${money(d.retail_cents)} from ${formatValue("effective_from", d.effective_from)}`;
    }
    case "tickets":
      return action === "INSERT" ? "Ticket issued" : `Ticket printed (${String(d.printed_count ?? "")} times)`;
    case "booking_participants":
      return `Participants: ${String(d.count ?? "")} ${String(d.participant_type ?? "")}${action === "DELETE" ? " removed" : ""}`;
    default: {
      const name = (d.name ?? d.full_name ?? [d.first_name, d.last_name].filter(Boolean).join(" ")) || d.key || "";
      const verb = action === "INSERT" ? "created" : action === "DELETE" ? "removed" : "changed";
      return `${tableLabel(table)} ${verb}${name ? `: ${String(name)}` : ""}`;
    }
  }
}
