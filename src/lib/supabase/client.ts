import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * Browser client — for auth UI only (sign in, sign out, password reset).
 * The browser never reads or writes application data directly; that all
 * goes through Server Actions and Server Components.
 */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey());
}
