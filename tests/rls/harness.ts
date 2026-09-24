import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { Database } from "@/lib/database.types";
import { addDays, businessDate } from "@/lib/dates";

type Client = SupabaseClient<Database>;
export type Role = Database["public"]["Enums"]["app_role"];
export type TableName = keyof Database["public"]["Tables"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  throw new Error(`The RLS suite only runs against a local Supabase stack, not ${url || "(unset)"}.`);
}
if (!anonKey || !serviceKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client: fixtures and after-the-fact checks only, never the thing under test. */
export const service: Client = createClient<Database>(url, serviceKey, noSession);

export const anon: Client = createClient<Database>(url, anonKey, noSession);

const PASSWORD = "rls-suite-password";

/** Signs in as a dedicated test user with this role, creating it on first run. */
export async function signInAs(role: Role, { active = true } = {}): Promise<{ client: Client; userId: string }> {
  const email = `rls-${role}${active ? "" : "-inactive"}@aquasail.test`;
  const created = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { role, full_name: `RLS ${role}` },
  });
  let userId = created.data.user?.id;
  if (!userId) {
    const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    userId = data.users.find((u) => u.email === email)?.id;
    if (!userId) throw created.error ?? new Error(`Could not create ${email}.`);
  }
  const reset = await service.from("profiles").update({ role, is_active: active }).eq("id", userId);
  if (reset.error) throw reset.error;

  const client = createClient<Database>(url, anonKey, noSession);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { client, userId };
}

function must<T>(res: { data: T; error: PostgrestError | null }): NonNullable<T> {
  if (res.error) throw res.error;
  if (res.data === null || res.data === undefined) throw new Error("Fixture insert returned no data.");
  return res.data;
}

/** Fresh rows for one test file: a client, an activity with a price, bookings today and yesterday, a payment on each. */
export async function createFixtures() {
  const tag = randomUUID().slice(0, 8);
  const today = businessDate();
  const client = must(
    await service
      .from("clients")
      .insert({ first_name: "Rls", last_name: tag, phone_e164: `+2305${Math.floor(1e6 + Math.random() * 8e6)}` })
      .select()
      .single(),
  );
  const activity = must(
    await service
      .from("activities")
      .insert({ code: `RLS_${tag}`, name: `RLS activity ${tag}` })
      .select()
      .single(),
  );
  const price = must(
    await service
      .from("price_rules")
      .insert({
        scope: "activity",
        activity_id: activity.id,
        audience: "walk_in",
        participant_type: "adult",
        retail_cents: 150000,
        effective_from: today,
      })
      .select()
      .single(),
  );
  const booking = async (serviceDate: string, suffix: string) =>
    must(
      await service
        .from("bookings")
        .insert({
          reference: `RLS-${tag}-${suffix}`,
          client_id: client.id,
          source_type: "walk_in",
          service_date: serviceDate,
          charged_total_cents: 150000,
        })
        .select()
        .single(),
    );
  const todayBooking = await booking(today, "T");
  const pastBooking = await booking(addDays(today, -1), "Y");
  const payment = must(
    await service
      .from("payments")
      .insert({ booking_id: todayBooking.id, amount_cents: 150000, method: "cash", received_from: "client" })
      .select()
      .single(),
  );
  return { tag, today, client, activity, price, todayBooking, pastBooking, payment };
}

/**
 * The request was refused: either a privilege error (42501) or RLS filtered
 * every row. Any other error fails, so a typo cannot pass as "denied".
 */
export function expectRefused(res: { data: unknown; error: PostgrestError | null }) {
  if (res.error) {
    expect(res.error.code, res.error.message).toBe("42501");
  } else {
    expect(res.data ?? []).toEqual([]);
  }
}

/** A database function raised (any error): used for role checks inside functions. */
export function expectRaised(res: { error: PostgrestError | null }, message?: string) {
  expect(res.error, "expected the call to be rejected").not.toBeNull();
  if (message) expect(res.error?.message).toContain(message);
}

// Record<TableName, true> makes the type checker fail when a table is added
// to the schema but not to this suite.
const TABLES: Record<TableName, true> = {
  activities: true,
  app_settings: true,
  audit_logs: true,
  booking_activities: true,
  booking_items: true,
  booking_participants: true,
  booking_sequences: true,
  bookings: true,
  clients: true,
  package_activities: true,
  packages: true,
  payments: true,
  price_rules: true,
  profiles: true,
  resources: true,
  tickets: true,
  tour_operators: true,
};
export const ALL_TABLES = Object.keys(TABLES) as TableName[];
