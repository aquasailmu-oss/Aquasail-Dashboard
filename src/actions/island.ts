"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { friendlyDbError } from "@/lib/db-errors";
import { readDeviceCredentials, saveDeviceCredentials } from "@/lib/device";
import type { ManifestData } from "@/lib/offline/idb";
import { fail, ok, type Result } from "@/lib/result";
import {
  checkInResultSchema,
  redeemResultSchema,
  scanResultSchema,
  syncResultSchema,
  tokenFromQr,
  type CheckInResult,
  type RedeemResult,
  type ScanResult,
  type SyncItemResult,
} from "@/lib/scan";
import { createClient } from "@/lib/supabase/server";

/** Who uses the island app. Reception scans from the booking page, not here. */
const ISLAND = ["activity_staff", "activity_supervisor", "admin"] as const;

const registerSchema = z.object({
  label: z.string().trim().min(2, "Give the device a name, like “Island tablet 3”.").max(60, "Keep the name short."),
  location_id: z.uuid({ error: "Choose where this device is used." }),
});

/** Registers this tablet (supervisor or admin) and keeps its secret in an httpOnly cookie. */
export async function registerDevice(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(["activity_supervisor", "admin"]);
  if (!auth.ok) return auth;
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the device name and place.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_device", {
    p_label: parsed.data.label,
    p_location_id: parsed.data.location_id,
  });
  if (error) return fail(friendlyDbError(error, "The device could not be registered. Try again."));
  const registered = z.object({ device_id: z.uuid(), secret: z.string() }).parse(data);
  await saveDeviceCredentials({ deviceId: registered.device_id, secret: registered.secret });
  revalidatePath("/scan");
  return ok(null);
}

async function scan(call: "scan_ticket" | "scan_reference", value: string): Promise<Result<ScanResult>> {
  const ctx = await islandContext();
  if (!ctx.ok) return ctx;
  const supabase = await createClient();
  const { data, error } =
    call === "scan_ticket"
      ? await supabase.rpc("scan_ticket", { p_token: value, ...ctx.data })
      : await supabase.rpc("scan_reference", { p_reference: value, ...ctx.data });
  if (error) return fail(friendlyDbError(error, "The ticket could not be checked. Try again."));
  const parsed = scanResultSchema.safeParse(data);
  if (!parsed.success) return fail("The ticket could not be read. Try again.");
  return ok(parsed.data);
}

/** What a scanned QR code says. A code that is not an AquaSail ticket is NOT_FOUND without asking the database. */
export async function scanCode(text: string): Promise<Result<ScanResult>> {
  const token = tokenFromQr(z.string().max(500).catch("").parse(text));
  if (!token) {
    const auth = await authorize([...ISLAND]);
    return auth.ok ? ok({ verdict: "NOT_FOUND" }) : auth;
  }
  return scan("scan_ticket", token);
}

/** Manual entry: "0042" for today's booking, or the full reference. */
export async function scanReference(reference: string): Promise<Result<ScanResult>> {
  const parsed = z.string().trim().min(1, "Type the booking reference.").max(40).safeParse(reference);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Type the booking reference.");
  return scan("scan_reference", parsed.data);
}

/** The signed-in island user and this device's credentials, or the reason there are none. */
async function islandContext() {
  const auth = await authorize([...ISLAND]);
  if (!auth.ok) return auth;
  const device = await readDeviceCredentials();
  if (!device) return fail("This device is not registered. Ask a supervisor to register it.");
  return ok({ p_device_id: device.deviceId, p_device_secret: device.secret });
}

const checkInSchema = z.object({ bookingId: z.uuid(), clientUuid: z.uuid() });

/** The party has arrived. A second check-in keeps the first time; it is not an error. */
export async function checkInParty(input: z.input<typeof checkInSchema>): Promise<Result<CheckInResult>> {
  const ctx = await islandContext();
  if (!ctx.ok) return ctx;
  const parsed = checkInSchema.safeParse(input);
  if (!parsed.success) return fail("This check-in could not be sent. Scan the ticket again.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_in_booking", {
    p_booking_id: parsed.data.bookingId,
    p_client_uuid: parsed.data.clientUuid,
    ...ctx.data,
  });
  if (error) return fail(friendlyDbError(error, "The check-in did not go through. Try again."));
  return ok(checkInResultSchema.parse(data));
}

const redeemSchema = z.object({
  bookingActivityId: z.uuid(),
  quantity: z.number().int().min(1).max(500),
  clientUuid: z.uuid(),
});

/** Redeems part or all of one entitlement. The request id comes from the device, so a retry lands once. */
export async function redeemEntitlement(input: z.input<typeof redeemSchema>): Promise<Result<RedeemResult>> {
  const ctx = await islandContext();
  if (!ctx.ok) return ctx;
  const parsed = redeemSchema.safeParse(input);
  if (!parsed.success) return fail("Choose how many to redeem.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_activity", {
    p_booking_activity_id: parsed.data.bookingActivityId,
    p_quantity: parsed.data.quantity,
    p_client_uuid: parsed.data.clientUuid,
    ...ctx.data,
  });
  if (error) return fail(friendlyDbError(error, "The redemption did not go through. Try again."));
  return ok(redeemResultSchema.parse(data));
}

/** The UNDO on a row, within 30 seconds of redeeming. After that it needs a supervisor. */
export async function undoRedemption(redemptionId: string): Promise<Result<RedeemResult>> {
  const ctx = await islandContext();
  if (!ctx.ok) return ctx;
  const id = z.uuid().safeParse(redemptionId);
  if (!id.success) return fail("That redemption could not be found.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reverse_redemption", {
    p_redemption_id: id.data,
    p_reason: "Undo within 30 s",
    ...ctx.data,
  });
  if (error) return fail(friendlyDbError(error, "The undo did not go through. Ask a supervisor."));
  return ok(redeemResultSchema.parse(data));
}

// ---------------------------------------------------------------------------
// WP-29: Offline support — manifest and sync
// ---------------------------------------------------------------------------

const manifestSchema = z.object({
  generated_at: z.string(),
  business_date: z.string(),
  bookings: z.array(
    z.object({
      booking_id: z.string(),
      token_hash: z.string().nullable(),
      reference: z.string(),
      surname: z.string(),
      client_first_initial: z.string(),
      adults: z.number().int(),
      children: z.number().int(),
      infants: z.number().int(),
      service_date: z.string(),
      departure_time: z.string().nullable(),
      meeting_point: z.string().nullable(),
      checked_in_at: z.string().nullable(),
      entitlements: z.array(
        z.object({
          booking_activity_id: z.string(),
          activity_code: z.string(),
          activity_name: z.string(),
          quantity: z.number().int(),
          already_redeemed: z.number().int(),
        }),
      ),
    }),
  ),
});

/** Pulls today's manifest from the server. */
export async function fetchManifest(): Promise<Result<ManifestData>> {
  const ctx = await islandContext();
  if (!ctx.ok) return ctx;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("day_manifest", ctx.data);
  if (error) return fail(friendlyDbError(error, "The manifest could not be loaded. Try again."));
  const parsed = manifestSchema.safeParse(data);
  if (!parsed.success) return fail("The manifest could not be read. Try again.");
  return ok(parsed.data);
}

const syncItemSchema = z.object({
  type: z.enum(["redeem", "check_in"]),
  client_uuid: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
});

/** Syncs one queued item from the offline queue. */
export async function syncQueueItem(
  type: string,
  payload: Record<string, unknown>,
): Promise<Result<SyncItemResult>> {
  const ctx = await islandContext();
  if (!ctx.ok) return ctx;
  const parsed = syncItemSchema.safeParse({ type, client_uuid: payload.client_uuid, payload });
  if (!parsed.success) return fail("This item could not be synced.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sync_queued_item", {
    ...ctx.data,
    p_type: parsed.data.type,
    p_payload: parsed.data.payload as unknown as Record<string, never>,
  });
  if (error) return fail(friendlyDbError(error, "The sync did not go through. Try again."));
  const result = syncResultSchema.safeParse(data);
  if (!result.success) return fail("The sync result could not be read.");
  return ok(result.data);
}

// ---------------------------------------------------------------------------
// WP-30: Supervisor tools — review queue, reversal, device management, shift
// ---------------------------------------------------------------------------

const SUPERVISOR = ["activity_supervisor", "admin"] as const;

export type ReviewItem = {
  redemption_id: string;
  booking_id: string;
  reference: string;
  client_surname: string;
  activity_name: string;
  quantity_redeemed: number;
  is_over_redemption: boolean;
  is_provisional: boolean;
  redeemed_at: string;
  occurred_at_device: string | null;
  synced_at: string | null;
  redeemed_by_name: string | null;
  device_label: string | null;
  location_name: string | null;
  entitlement_quantity: number;
  is_stale: boolean;
};

const reviewItemSchema = z.object({
  redemption_id: z.string(),
  booking_id: z.string(),
  reference: z.string(),
  client_surname: z.string(),
  activity_name: z.string(),
  quantity_redeemed: z.number().int(),
  is_over_redemption: z.boolean(),
  is_provisional: z.boolean(),
  redeemed_at: z.string(),
  occurred_at_device: z.string().nullable(),
  synced_at: z.string().nullable(),
  redeemed_by_name: z.string().nullable(),
  device_label: z.string().nullable(),
  location_name: z.string().nullable(),
  entitlement_quantity: z.number().int(),
  is_stale: z.boolean(),
});

/** Loads the review queue — flagged redemptions that need supervisor attention. */
export async function fetchReviewQueue(): Promise<Result<ReviewItem[]>> {
  const ctx = await supervisorContext();
  if (!ctx.ok) return ctx;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_queue", ctx.data);
  if (error) return fail(friendlyDbError(error, "The review queue could not be loaded."));
  const parsed = z.array(reviewItemSchema).safeParse(data);
  if (!parsed.success) return fail("The review queue could not be read.");
  return ok(parsed.data);
}

const resolveSchema = z.object({
  redemptionId: z.uuid(),
  action: z.enum(["accept", "reverse"]),
  note: z.string().trim().min(1, "Add a note saying what happened.").max(500),
});

/** Resolves a flagged over-redemption: accept or reverse, with a note. */
export async function resolveOverRedemption(input: z.input<typeof resolveSchema>): Promise<Result<null>> {
  const ctx = await supervisorContext();
  if (!ctx.ok) return ctx;
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the inputs.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_over_redemption", {
    p_redemption_id: parsed.data.redemptionId,
    p_action: parsed.data.action,
    p_note: parsed.data.note,
    ...ctx.data,
  });
  if (error) return fail(friendlyDbError(error, "The resolution did not go through."));
  return ok(null);
}

const supervisorReverseSchema = z.object({
  redemptionId: z.uuid(),
  reason: z.string().trim().min(1, "Give a reason for the reversal.").max(500),
});

/** A supervisor reverses a redemption within 24 hours. */
export async function supervisorReverseRedemption(
  input: z.input<typeof supervisorReverseSchema>,
): Promise<Result<null>> {
  const ctx = await supervisorContext();
  if (!ctx.ok) return ctx;
  const parsed = supervisorReverseSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the inputs.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_redemption", {
    p_redemption_id: parsed.data.redemptionId,
    p_reason: parsed.data.reason,
    ...ctx.data,
  });
  if (error) return fail(friendlyDbError(error, "The reversal did not go through."));
  return ok(null);
}

export type DeviceInfo = {
  device_id: string;
  label: string;
  location_name: string | null;
  registered_at: string;
  last_seen_at: string | null;
  is_active: boolean;
};

const deviceInfoSchema = z.object({
  device_id: z.string(),
  label: z.string(),
  location_name: z.string().nullable(),
  registered_at: z.string(),
  last_seen_at: z.string().nullable(),
  is_active: z.boolean(),
});

/** Lists all registered devices (active and inactive). */
export async function fetchDeviceList(): Promise<Result<DeviceInfo[]>> {
  const ctx = await supervisorContext();
  if (!ctx.ok) return ctx;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("device_list", ctx.data);
  if (error) return fail(friendlyDbError(error, "The device list could not be loaded."));
  const parsed = z.array(deviceInfoSchema).safeParse(data);
  if (!parsed.success) return fail("The device list could not be read.");
  return ok(parsed.data);
}

/** Deactivates a device — it can no longer scan or redeem. */
export async function deactivateDevice(targetDeviceId: string): Promise<Result<null>> {
  const ctx = await supervisorContext();
  if (!ctx.ok) return ctx;
  const id = z.uuid().safeParse(targetDeviceId);
  if (!id.success) return fail("That device could not be found.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_device", {
    p_target_device_id: id.data,
    ...ctx.data,
  });
  if (error) return fail(friendlyDbError(error, "The device could not be deactivated."));
  return ok(null);
}

export type ShiftSummary = {
  device_label: string;
  date: string;
  check_ins: number;
  redemptions: Array<{ activity_name: string; total_redeemed: number }>;
  flagged: number;
};

const shiftSummarySchema = z.object({
  device_label: z.string(),
  date: z.string(),
  check_ins: z.number().int(),
  redemptions: z.array(z.object({ activity_name: z.string(), total_redeemed: z.number() })),
  flagged: z.number().int(),
});

/** This device's activity today: check-ins, redemptions by activity, flagged items. */
export async function fetchShiftSummary(): Promise<Result<ShiftSummary>> {
  const ctx = await islandContext();
  if (!ctx.ok) return ctx;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shift_summary", ctx.data);
  if (error) return fail(friendlyDbError(error, "The shift summary could not be loaded."));
  const parsed = shiftSummarySchema.safeParse(data);
  if (!parsed.success) return fail("The shift summary could not be read.");
  return ok(parsed.data);
}

/** Device + auth for supervisor-only functions. */
async function supervisorContext() {
  const auth = await authorize([...SUPERVISOR]);
  if (!auth.ok) return auth;
  const device = await readDeviceCredentials();
  if (!device) return fail("This device is not registered. Ask a supervisor to register it.");
  return ok({ p_device_id: device.deviceId, p_device_secret: device.secret });
}
