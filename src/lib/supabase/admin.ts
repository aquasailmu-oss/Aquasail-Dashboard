/**
 * SERVICE-ROLE CLIENT — BYPASSES ROW LEVEL SECURITY.
 *
 * Only for scheduled jobs, internal webhooks, and the admin-only user
 * invitation action (which must be guarded by requireRole(['admin'])).
 * Never use it in a request path driven by ordinary user input, and never
 * use it to read or write business data on a user's behalf — use the
 * session client in ./server.ts so RLS applies.
 *
 * `server-only` makes any import from a Client Component a build error;
 * the runtime check below is a second guard.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { supabaseUrl } from "./env";

if (typeof window !== "undefined") {
  throw new Error(
    "src/lib/supabase/admin.ts was loaded in the browser. The service-role key must never leave the server.",
  );
}

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing environment variable SUPABASE_SERVICE_ROLE_KEY.");
  return createClient<Database>(supabaseUrl(), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
