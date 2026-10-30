"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { fail, ok, type Result } from "@/lib/result";
import { publicOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const staffRoles = ["admin", "receptionist"] as const;

export type PublicWaiverState = {
  valid: boolean;
  reference?: string;
  service_date?: string;
  disclaimer_text?: string;
  adult_required?: number;
  child_required?: number;
  infant_required?: number;
  adult_signed?: number;
  child_signed?: number;
  infant_signed?: number;
  required_count?: number;
  signed_count?: number;
  complete?: boolean;
};

/** Issues another high-entropy, single-booking signing link; only its hash is stored. */
export async function createWaiverLink(bookingId: string): Promise<Result<{ url: string; expiresOn: string }>> {
  const auth = await authorize(staffRoles);
  if (!auth.ok) return auth;
  const id = z.uuid().safeParse(bookingId);
  if (!id.success) return fail("That booking could not be found.");

  let origin: string;
  try {
    origin = await publicOrigin();
  } catch {
    return fail("Configure APP_BASE_URL as the public HTTPS address for customer waiver links, then try again.");
  }

  const token = randomBytes(32).toString("base64url");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_booking_waiver_link", {
    p_booking_id: id.data,
    p_token: token,
  });
  if (error || !data) {
    const message = error?.message ?? "Could not create the waiver link.";
    if (/approved waiver text/i.test(message))
      return fail("Set the approved waiver wording in Settings before creating a QR code.");
    if (/past booking/i.test(message)) return fail("A waiver link cannot be created for a past booking.");
    if (/cancelled/i.test(message)) return fail("A waiver link cannot be created for a cancelled booking.");
    return fail("Could not create the waiver link. Refresh the page and try again.");
  }

  const url = new URL(`/waiver/${token}`, origin).toString();
  revalidatePath(`/bookings/${id.data}`);
  return ok({ url, expiresOn: data });
}

export async function revokeWaiverLinks(bookingId: string): Promise<Result<null>> {
  const auth = await authorize(staffRoles);
  if (!auth.ok) return auth;
  const id = z.uuid().safeParse(bookingId);
  if (!id.success) return fail("That booking could not be found.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_booking_waiver_links", { p_booking_id: id.data });
  if (error) return fail("The active waiver links could not be revoked. Refresh the page and try again.");
  revalidatePath(`/bookings/${id.data}`);
  return ok(null);
}

export async function getWaiverEvidence(
  bookingId: string,
  waiverId: string,
): Promise<
  Result<{
    participantName: string;
    participantType: string;
    signerName: string;
    relationship: string;
    signedAt: string;
    signatureData: string;
    disclaimerText: string;
  }>
> {
  const auth = await authorize(["admin", "accountant", "receptionist"]);
  if (!auth.ok) return auth;
  const ids = z.object({ bookingId: z.uuid(), waiverId: z.uuid() }).safeParse({ bookingId, waiverId });
  if (!ids.success) return fail("That signed waiver could not be found.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_waivers")
    .select(
      "participant_name, participant_type, signer_name, signer_relationship, signed_at, signature_data, disclaimer_text",
    )
    .eq("booking_id", ids.data.bookingId)
    .eq("id", ids.data.waiverId)
    .maybeSingle();
  if (error || !data) return fail("That signed waiver could not be found.");
  return ok({
    participantName: data.participant_name,
    participantType: data.participant_type,
    signerName: data.signer_name,
    relationship: data.signer_relationship,
    signedAt: data.signed_at,
    signatureData: data.signature_data,
    disclaimerText: data.disclaimer_text,
  });
}

export async function getPublicWaiver(token: string): Promise<PublicWaiverState | null> {
  const parsed = TOKEN.safeParse(token);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_booking_waiver", { p_token: parsed.data });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const state = data as unknown as PublicWaiverState;
  return state.valid ? state : null;
}

const submitSchema = z.object({
  token: TOKEN,
  participant_type: z.enum(["adult", "child", "infant"]),
  participant_name: z.string().trim().min(1).max(160),
  signer_name: z.string().trim().min(1).max(160),
  signer_relationship: z.enum(["self", "parent", "legal_guardian"]),
  signature_data: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)
    .max(500_000),
  guardian_authority_confirmed: z.boolean(),
  submission_id: z.uuid(),
  acknowledged: z.literal(true),
});

export async function submitPublicWaiver(input: z.input<typeof submitSchema>): Promise<Result<null>> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Complete each field and sign the waiver.");
  const d = parsed.data;
  if (
    d.participant_type === "adult" &&
    d.signer_relationship === "self" &&
    d.participant_name.toLocaleLowerCase() !== d.signer_name.toLocaleLowerCase()
  ) {
    return fail("For an adult signing for themselves, enter the same name in both fields.");
  }
  if (
    (d.participant_type !== "adult" || d.signer_relationship !== "self") &&
    !["parent", "legal_guardian"].includes(d.signer_relationship)
  ) {
    return fail("A parent or legal guardian must sign for a child or infant.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_booking_waiver", {
    p_token: d.token,
    p_participant_type: d.participant_type,
    p_participant_name: d.participant_name,
    p_signer_name: d.signer_name,
    p_signer_relationship: d.signer_relationship,
    p_signature_data: d.signature_data,
    p_guardian_authority_confirmed: d.guardian_authority_confirmed,
    p_submission_id: d.submission_id,
    p_acknowledged: d.acknowledged,
  });
  if (error) {
    const message = error.message;
    if (/already signed|already been recorded/i.test(message))
      return fail("All waivers for that participant type have already been recorded. Ask staff to check the booking.");
    if (/invalid or has expired/i.test(message))
      return fail("This waiver link is invalid, revoked, or expired. Ask AquaSail staff for a current QR code.");
    if (/parent or legal guardian/i.test(message))
      return fail("A parent or legal guardian must sign for a child or infant.");
    if (/complete the name/i.test(message))
      return fail("Complete each field, agree to the disclaimer, and add your signature.");
    return fail("Your waiver could not be saved. Please check the form and try again.");
  }
  return ok(null);
}
