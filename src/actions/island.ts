"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { friendlyDbError } from "@/lib/db-errors";
import { readDeviceCredentials, saveDeviceCredentials } from "@/lib/device";
import { fail, ok, type Result } from "@/lib/result";
import { scanResultSchema, tokenFromQr, type ScanResult } from "@/lib/scan";
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
  const auth = await authorize([...ISLAND]);
  if (!auth.ok) return auth;
  const device = await readDeviceCredentials();
  if (!device) return fail("This device is not registered. Ask a supervisor to register it.");
  const supabase = await createClient();
  const credentials = { p_device_id: device.deviceId, p_device_secret: device.secret };
  const { data, error } =
    call === "scan_ticket"
      ? await supabase.rpc("scan_ticket", { p_token: value, ...credentials })
      : await supabase.rpc("scan_reference", { p_reference: value, ...credentials });
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
