import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * For release checks and uptime monitors (docs/RELEASE.md): the app's version
 * and whether the database answers. Public, and reveals nothing else.
 */
export async function GET() {
  const version = { app: pkg.version, commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local" };
  const supabase = createClient(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false } });
  const started = Date.now();
  const { data, error } = await supabase.rpc("health_check");
  const database = error
    ? { status: "unreachable" }
    : { status: "ok", latency_ms: Date.now() - started, ...(data as object) };
  return NextResponse.json(
    { status: error ? "degraded" : "ok", version, database, checked_at: new Date().toISOString() },
    { status: error ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
