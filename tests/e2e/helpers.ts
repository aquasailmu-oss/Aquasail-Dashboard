import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** The demo accounts from supabase/seed.sql. */
export const USERS = {
  admin: "admin@aquasail.test",
  receptionist: "reception@aquasail.test",
  accountant: "accounts@aquasail.test",
  activity_staff: "island@aquasail.test",
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

/** Choose a client-pays operator whose prices follow the walk-in retail table. */
export async function selectBookingOperator(page: Page, name: RegExp = /Sofitel Merville/) {
  await page.getByRole("radio", { name }).check();
  await page.getByRole("button", { name: "Continue to booking" }).click();
  await expect(page.locator("#first_name")).toBeVisible();
}

export async function signPublicWaiver(
  page: Page,
  url: string,
  participantName: string,
  type: "adult" | "child" | "infant" = "adult",
) {
  await page.goto(url);
  await page.selectOption("#participant_type", type);
  await page.fill("#participant_name", participantName);
  if (type === "adult") {
    await page.selectOption("#signer_relationship", "self");
  } else {
    await page.fill("#signer_name", "Guardian Test");
    await page.getByRole("checkbox", { name: /I confirm I am this participant/ }).check();
  }
  await page.getByRole("checkbox", { name: /I have read the waiver above/ }).check();
  const pad = await page.locator("#waiver_signature").boundingBox();
  expect(pad).not.toBeNull();
  await page.mouse.move(pad!.x + 20, pad!.y + pad!.height / 2);
  await page.mouse.down();
  await page.mouse.move(pad!.x + 160, pad!.y + pad!.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Sign and submit waiver" }).click();
  await expect(
    page.getByText(/Your waiver has been saved\.|All participants on this booking have signed\./),
  ).toBeVisible();
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
