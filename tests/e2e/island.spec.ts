import { expect, test } from "@playwright/test";
import { db, login, tag, today } from "./helpers";

// WP-27: the island app. The camera cannot run headless, so these go through
// ENTER REFERENCE, which answers exactly as a scan does (scan_reference()
// and scan_ticket() share one payload; supabase/tests/island_app.test.sql).

async function todaysConfirmedReference(): Promise<string> {
  const { data } = await db
    .from("bookings")
    .select("reference, tickets!inner(revoked_at)")
    .eq("service_date", today())
    .eq("status", "confirmed")
    .like("reference", "WS-%") // not the RLS suite's fixtures, whose references have no digits to type
    .is("tickets.revoked_at", null)
    .order("reference")
    .limit(1)
    .single();
  return data!.reference;
}

test("a supervisor registers the tablet; staff sign in on it and check a ticket by reference", async ({ page }) => {
  const label = `E2E tablet ${tag()}`;
  await login(page, "activity_supervisor");
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.locator("main").getByRole("alert")).toHaveText("This device is not registered yet.");
  await page.getByRole("button", { name: "REGISTER DEVICE" }).click();
  await expect(page.getByText("Give the device a name, like “Island tablet 3”.")).toBeVisible();
  await page.fill("#label", label);
  await page.getByLabel("Ile aux Cerfs").check();
  await page.getByRole("button", { name: "REGISTER DEVICE" }).click();
  await expect(page.getByTestId("status-bar")).toContainText(`${label} · Ile aux Cerfs`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");

  // The device stays registered; island staff now sign in on top of it.
  await login(page, "activity_staff");
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.getByTestId("status-bar")).toContainText("Sam Island");
  await expect(page.getByTestId("status-bar")).toContainText(label);

  const reference = await todaysConfirmedReference();
  await page.getByRole("button", { name: "ENTER REFERENCE" }).click();
  await page.fill("#reference", reference.slice(-4));
  await page.getByRole("button", { name: "CHECK TICKET" }).click();
  const verdict = page.getByTestId("verdict");
  await expect(verdict).toHaveAttribute("data-verdict", /^(VALID|PARTLY_USED|ALREADY_REDEEMED)$/);
  await expect(verdict).toContainText(reference);
  await expect(verdict.getByRole("list", { name: "Entitlements" }).getByRole("listitem").first()).toBeVisible();
  await expect(verdict.getByLabel("Not included")).toContainText("NOT INCLUDED:");
  await expect(verdict).not.toContainText("Rs ");

  await verdict.getByRole("button", { name: "SCAN NEXT" }).click();
  await expect(page.getByRole("button", { name: "ENTER REFERENCE" })).toBeVisible();

  await page.getByRole("button", { name: "ENTER REFERENCE" }).click();
  await page.fill("#reference", "9999");
  await page.getByRole("button", { name: "CHECK TICKET" }).click();
  await expect(verdict).toHaveAttribute("data-verdict", "NOT_FOUND");
  await verdict.getByRole("button", { name: "ENTER REFERENCE" }).click();
  await expect(page.locator("#reference")).toBeFocused();
});

test("staff on an unregistered device are told who to ask", async ({ page }) => {
  await login(page, "activity_staff");
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "This device is not registered. Ask a supervisor to sign in on it and register it.",
  );
  await expect(page.getByRole("button", { name: "REGISTER DEVICE" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
});
