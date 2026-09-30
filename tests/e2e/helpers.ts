import { expect, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import jsQR from "jsqr";
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@/lib/database.types";

/** The demo accounts from supabase/seed.sql. */
export const USERS = {
  admin: "admin@aquasail.test",
  receptionist: "reception@aquasail.test",
  accountant: "accounts@aquasail.test",
  activity_staff: "island@aquasail.test",
  activity_supervisor: "supervisor@aquasail.test",
} as const;
export const PASSWORD = "demo-password-1";

/** Service-role client for assertions only: the browser under test never gets it. */
export const db = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  {
    auth: { persistSession: false },
  },
);

/** A suffix that keeps names unique across reruns against the same database. */
export const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Mauritius" }).format(new Date());
export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function login(page: Page, role: keyof typeof USERS) {
  await page.goto("/login");
  await page.fill("#email", USERS[role]);
  await page.fill("#password", PASSWORD);
  await page.locator("main button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export async function logout(page: Page) {
  await page.locator("header").getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
}

/** The live quote total once it has settled. */
export async function expectTotal(page: Page, text: string) {
  await expect(page.getByTestId("quote-total")).toHaveText(text);
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
}

/** Replace the print dialog (headless browsers cannot show one) with a counter that still fires beforeprint. */
export async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints++;
      window.dispatchEvent(new Event("beforeprint"));
    };
  });
}

export async function bookingByReference(reference: string) {
  const { data } = await db
    .from("bookings")
    .select("*, payments(amount_cents, method), booking_activities(quantity, activities(code))")
    .eq("reference", reference)
    .single();
  return data;
}

/**
 * Reads a rendered QR code the way a camera does: rasterises the <svg> in the
 * browser and decodes the pixels. Returns the encoded text, or null.
 */
export async function decodeQr(svg: Locator): Promise<string | null> {
  const px = 450;
  const pixels = await svg.evaluate(async (el, size) => {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(el))}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, size, size);
    return Array.from(ctx.getImageData(0, 0, size, size).data);
  }, px);
  return jsQR(Uint8ClampedArray.from(pixels), px, px)?.data ?? null;
}

/**
 * Makes this browser a registered island tablet: a device row with a known
 * secret, and the httpOnly cookie the app would have set on registering it.
 */
export async function useIslandDevice(page: Page, label: string): Promise<void> {
  const secret = randomBytes(32).toString("hex");
  const { data: location } = await db.from("locations").select("id").eq("code", "ISLAND").single();
  const { data: device, error } = await db
    .from("staff_devices")
    .insert({
      label,
      location_id: location!.id,
      device_secret_hash: createHash("sha256").update(secret).digest("hex"),
    })
    .select("id")
    .single();
  if (error) throw error;
  await page
    .context()
    .addCookies([
      { name: "aquasail_device", value: `${device.id}:${secret}`, url: "http://localhost:3000", httpOnly: true },
    ]);
}
