import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

/**
 * The uploaded company logo, served from the app's own origin (for tickets
 * and the settings preview). Signed-in staff only, like every app route.
 * Pages add ?v=<logo_path> so a new upload shows at once despite the cache.
 */
export async function GET() {
  const { logo_path } = await getSettings();
  if (!logo_path) return new NextResponse(null, { status: 404 });

  const supabase = await createClient();
  const { data } = supabase.storage.from("branding").getPublicUrl(logo_path);
  const upstream = await fetch(data.publicUrl);
  if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: 404 });

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
}
