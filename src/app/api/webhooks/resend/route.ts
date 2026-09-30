import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const SIGNING_SECRET = process.env.RESEND_WEBHOOK_SECRET;

/**
 * Resend webhook: updates message_log with delivery/bounce/open events.
 * Verifies the Resend-Webhook-Signature header (HMAC SHA-256) when
 * RESEND_WEBHOOK_SECRET is set.
 */
export async function POST(request: Request) {
  const body = await request.text();

  if (SIGNING_SECRET) {
    const signature = request.headers.get("resend-webhook-signature");
    if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    const valid = await verifySignature(body, signature, SIGNING_SECRET);
    if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { type?: string; data?: { email_id?: string } };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const emailId = payload?.data?.email_id;
  const eventType = payload?.type;
  if (!emailId || !eventType) {
    return NextResponse.json({ ok: true });
  }

  const eventMap: Record<string, string> = {
    "email.delivered": "delivered",
    "email.opened": "opened",
    "email.bounced": "bounced",
    "email.complained": "complained",
  };
  const mapped = eventMap[eventType];
  if (!mapped) return NextResponse.json({ ok: true });

  const supabase = createAdminClient();
  await supabase.rpc("update_delivery_webhook", {
    p_provider_message_id: emailId,
    p_event: mapped,
  });

  return NextResponse.json({ ok: true });
}

async function verifySignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Buffer.from(sig).toString("hex");
  return expected === signature;
}
