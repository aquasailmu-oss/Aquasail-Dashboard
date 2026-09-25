import "server-only";
import { z } from "zod";
import { addDays, businessDate, parseDateInput } from "@/lib/dates";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Filters for the booking register (/bookings) and its Excel export. They
 * live in the URL so a view can be bookmarked and shared, and both read the
 * booking_register view, so the page and the spreadsheet always agree.
 */
export const PAYMENT_STATUSES = ["paid", "part_paid", "unpaid", "operator_account"] as const;
export const BOOKING_STATUSES = ["confirmed", "completed", "no_show", "cancelled"] as const;
export const SORTABLE = [
  "service_date",
  "reference",
  "client_name",
  "charged_total_cents",
  "balance_cents",
  "people",
] as const;

export type RegisterFilters = {
  from: string;
  to: string;
  source: string; // "all" | "walk_in" | operator id
  package: string | null;
  activity: string | null;
  payment: (typeof PAYMENT_STATUSES)[number] | null;
  status: (typeof BOOKING_STATUSES)[number] | null;
  createdBy: string | null;
  q: string;
  sort: (typeof SORTABLE)[number];
  dir: "asc" | "desc";
  page: number;
};

function thisMonth(): { from: string; to: string } {
  const today = businessDate();
  const from = `${today.slice(0, 8)}01`;
  const nextMonth = addDays(from, 32).slice(0, 8) + "01";
  return { from, to: addDays(nextMonth, -1) };
}

/**
 * A booking_register row. Postgres marks every view column nullable; these are
 * never null by the view's construction (only the optional ones say so).
 */
export type RegisterRow = {
  id: string;
  reference: string;
  reference_digits: string;
  service_date: string;
  departure_time: string | null;
  status: "confirmed" | "cancelled" | "no_show" | "completed";
  source_type: "walk_in" | "operator";
  operator_id: string | null;
  operator_name: string | null;
  payer: "client" | "operator";
  client_id: string;
  client_name: string;
  client_phone: string | null;
  resource_id: string | null;
  retail_total_cents: number;
  charged_total_cents: number;
  discount_total_cents: number;
  operator_net_total_cents: number;
  commission_total_cents: number;
  created_by: string | null;
  created_at: string;
  people: number;
  paid_cents: number;
  balance_cents: number;
  payment_status: "paid" | "part_paid" | "unpaid" | "operator_account";
  summary: string;
  package_ids: string[];
  activity_ids: string[];
};

const uuidOrNull = z.uuid().nullable().catch(null);

export function parseRegisterFilters(params: Record<string, string | string[] | undefined>): RegisterFilters {
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]) ?? "";
  const month = thisMonth();
  const from = parseDateInput(one("from")) ?? month.from;
  const to = parseDateInput(one("to")) ?? month.to;
  const source = one("source");
  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    source: source === "walk_in" || z.uuid().safeParse(source).success ? source : "all",
    package: uuidOrNull.parse(one("package") || null),
    activity: uuidOrNull.parse(one("activity") || null),
    payment: z
      .enum(PAYMENT_STATUSES)
      .nullable()
      .catch(null)
      .parse(one("payment") || null),
    status: z
      .enum(BOOKING_STATUSES)
      .nullable()
      .catch(null)
      .parse(one("status") || null),
    createdBy: uuidOrNull.parse(one("created_by") || null),
    q: one("q").trim().slice(0, 60),
    sort: z.enum(SORTABLE).catch("service_date").parse(one("sort")),
    dir: one("dir") === "asc" ? "asc" : "desc",
    page: Math.max(1, Number.parseInt(one("page"), 10) || 1),
  };
}

/** The filters as URL parameters, leaving out defaults. */
export function filtersToParams(f: RegisterFilters, changes: Partial<RegisterFilters> = {}): URLSearchParams {
  const next = { ...f, ...changes };
  const month = thisMonth();
  const params = new URLSearchParams();
  if (next.from !== month.from) params.set("from", next.from);
  if (next.to !== month.to) params.set("to", next.to);
  if (next.source !== "all") params.set("source", next.source);
  if (next.package) params.set("package", next.package);
  if (next.activity) params.set("activity", next.activity);
  if (next.payment) params.set("payment", next.payment);
  if (next.status) params.set("status", next.status);
  if (next.createdBy) params.set("created_by", next.createdBy);
  if (next.q) params.set("q", next.q);
  if (next.sort !== "service_date") params.set("sort", next.sort);
  if (next.dir !== "desc") params.set("dir", next.dir);
  if (next.page !== 1) params.set("page", String(next.page));
  return params;
}

const escapeLike = (s: string) => s.replace(/[\\%_,()]/g, (c) => `\\${c}`);

/**
 * A booking_register query with every filter applied (selection, order and
 * paging are the caller's). Synchronous on purpose: a query builder is
 * awaitable, so returning it from an async function would run it early.
 */
export function registerQuery(supabase: SupabaseClient<Database>, f: RegisterFilters, select: string, count?: "exact") {
  let q = supabase
    .from("booking_register")
    .select(select, count ? { count } : undefined)
    .gte("service_date", f.from)
    .lte("service_date", f.to);
  if (f.source === "walk_in") q = q.eq("source_type", "walk_in");
  else if (f.source !== "all") q = q.eq("operator_id", f.source);
  if (f.package) q = q.contains("package_ids", [f.package]);
  if (f.activity) q = q.contains("activity_ids", [f.activity]);
  if (f.payment) q = q.eq("payment_status", f.payment);
  if (f.status) q = q.eq("status", f.status);
  if (f.createdBy) q = q.eq("created_by", f.createdBy);
  if (f.q) {
    const t = escapeLike(f.q);
    const digits = f.q.replace(/\D/g, "");
    q = q.or(
      [`reference.ilike.%${t}%`, `client_name.ilike.%${t}%`]
        .concat(digits.length >= 3 ? [`reference_digits.ilike.%${digits}%`, `client_phone.ilike.%${digits}%`] : [])
        .join(","),
    );
  }
  return q;
}
