import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";

/**
 * The island device's identity: its staff_devices id and secret, kept in an
 * httpOnly cookie so page scripts never see the secret. It outlives the staff
 * member's session: the device is registered once, and people sign in on top
 * of it at the start of each shift (V2 plan §3.1).
 */
const COOKIE = "aquasail_device";
const FIVE_YEARS = 60 * 60 * 24 * 365 * 5;

type DeviceCredentials = { deviceId: string; secret: string };

export async function readDeviceCredentials(): Promise<DeviceCredentials | null> {
  const value = (await cookies()).get(COOKIE)?.value ?? "";
  const match = /^([0-9a-f-]{36}):([0-9a-f]{64})$/.exec(value);
  return match ? { deviceId: match[1], secret: match[2] } : null;
}

export async function saveDeviceCredentials({ deviceId, secret }: DeviceCredentials): Promise<void> {
  (await cookies()).set(COOKIE, `${deviceId}:${secret}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: FIVE_YEARS,
  });
}

export type DeviceInfo = { deviceId: string; label: string; locationName: string | null };

/**
 * This device as the database sees it: registered and active, or the reason
 * it is not ("This device has been deactivated. Ask a supervisor.").
 */
export async function currentDevice(): Promise<
  { status: "unregistered" } | { status: "refused"; reason: string } | { status: "ok"; device: DeviceInfo }
> {
  const credentials = await readDeviceCredentials();
  if (!credentials) return { status: "unregistered" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("device_info", {
    p_device_id: credentials.deviceId,
    p_device_secret: credentials.secret,
  });
  if (error) return { status: "refused", reason: friendlyDbError(error, "This device could not be checked.") };
  const info = z
    .object({ device_id: z.string(), label: z.string(), location_name: z.string().nullable() })
    .nullable()
    .parse(data);
  if (!info) return { status: "unregistered" };
  return { status: "ok", device: { deviceId: info.device_id, label: info.label, locationName: info.location_name } };
}
