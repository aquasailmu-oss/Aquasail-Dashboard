import type { PostgrestError } from "@supabase/supabase-js";

/**
 * A database error as a sentence staff can act on. Exceptions raised by our
 * own functions and triggers (P0001) are already written for people and are
 * passed through; anything else gets the caller's fallback, never a code.
 */
export function friendlyDbError(error: Pick<PostgrestError, "code" | "message">, fallback: string): string {
  if (error.code === "P0001") return error.message;
  if (error.code === "42501") return "Your role does not allow this.";
  return fallback;
}
