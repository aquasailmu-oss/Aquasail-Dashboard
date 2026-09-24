import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { friendlyDbError } from "@/lib/db-errors";
import { fail, ok, type Result } from "@/lib/result";
import type { Quote, QuoteInput } from "./types";

/**
 * Asks the pricing engine (build_quote() in Postgres) for a quote. It reads
 * price_rules with the database's authority, so this works for reception,
 * who can never read the price table itself. No writes.
 */
export async function fetchQuote(supabase: SupabaseClient<Database>, input: QuoteInput): Promise<Result<Quote>> {
  const { data, error } = await supabase.rpc("build_quote", { input: input as unknown as Json });
  if (error) return fail(friendlyDbError(error, "The price could not be worked out. Try again."));
  // The engine returns whole cents as JSON numbers; the shape is fixed by build_quote().
  return ok(data as unknown as Quote);
}
