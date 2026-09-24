import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/navigation";
import { requestOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["recovery", "invite", "magiclink", "signup", "email_change", "email"];

/**
 * Landing point for links in auth emails (password reset, and the admin
 * invite from WP-09). Handles both the PKCE `code` form and the `token_hash`
 * form, establishes the session, then continues to `next`.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = await requestOrigin();
  const next = safeNextPath(params.get("next")) ?? "/";
  const supabase = await createClient();

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  let error: unknown = new Error("missing token");
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  }

  if (error) return NextResponse.redirect(`${origin}/login?notice=link-expired`);
  return NextResponse.redirect(`${origin}${next}`);
}
