import { expect, test } from "@playwright/test";
import { db, expectTotal, login, logout, tag, today, useIslandDevice } from "./helpers";

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
  await expect(verdict.getByTestId("not-included").first()).toContainText("NOT INCLUDED");
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

// WP-28, the plan's definition of done 1-3: check a four-adult party in,
// redeem three of four lunches, undo, redeem again; a rescan shows what has
// gone, when, by whom and where; the last lunch; then ALREADY REDEEMED.
test("check in, redeem 3 of 4 lunches, undo, rescan shows the history, then ALREADY REDEEMED", async ({ page }) => {
  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await page.fill("#first_name", "Lunch");
  await page.fill("#last_name", `Party${tag()}`);
  await page.getByText("Island Explorer", { exact: true }).click();
  await page.fill("#adults", "4");
  await expectTotal(page, "Rs 12,800");
  await page.locator("input[name=boat]").first().check();
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);
  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  await logout(page);

  await useIslandDevice(page, `E2E redeem tablet ${tag()}`);
  await login(page, "activity_staff");
  const check = async () => {
    await page.getByRole("button", { name: "ENTER REFERENCE" }).click();
    await page.fill("#reference", reference);
    await page.getByRole("button", { name: "CHECK TICKET" }).click();
  };
  const verdict = page.getByTestId("verdict");
  const lunch = verdict.getByTestId("entitlement").filter({ hasText: "Beach BBQ Lunch" });

  await check();
  await expect(verdict).toHaveAttribute("data-verdict", "VALID");
  await expect(verdict.getByTestId("not-included").first()).toContainText("NOT INCLUDED");
  await verdict.getByRole("button", { name: "CHECK IN · 4 people" }).click();
  await expect(verdict.getByTestId("checked-in")).toContainText("by Sam Island");
  await expect(verdict.getByRole("button", { name: /CHECK IN/ })).toHaveCount(0);

  // Default is everything remaining; "3 of 4" is one tap on the stepper.
  await expect(lunch.getByRole("button", { name: "REDEEM 4" })).toBeVisible();
  await lunch.getByRole("button", { name: "One fewer Beach BBQ Lunch" }).click();
  await lunch.getByRole("button", { name: "REDEEM 3" }).click();
  await expect(lunch.getByTestId("remaining")).toHaveText("1 of 4 left");
  await expect(lunch).toContainText("3 used");
  await expect(lunch).toContainText("Sam Island · Ile aux Cerfs");

  await lunch.getByRole("button", { name: "UNDO" }).click();
  await expect(lunch.getByTestId("remaining")).toHaveText("4 of 4 left");
  await expect(lunch).toContainText("3 undone");
  await lunch.getByRole("button", { name: "One fewer Beach BBQ Lunch" }).click();
  await lunch.getByRole("button", { name: "REDEEM 3" }).click();
  await expect(lunch.getByTestId("remaining")).toHaveText("1 of 4 left");

  // An hour later, on a fresh scan: PARTLY USED, with who/when/where for the first three.
  await verdict.getByRole("button", { name: "SCAN NEXT" }).click();
  await check();
  await expect(verdict).toHaveAttribute("data-verdict", "PARTLY_USED");
  await expect(verdict.getByTestId("checked-in")).toContainText("by Sam Island");
  await expect(lunch).toContainText("3 used");
  await expect(lunch.getByRole("button", { name: "REDEEM 1" })).toBeVisible();
  await lunch.getByRole("button", { name: "REDEEM 1" }).click();
  await expect(lunch.getByTestId("remaining")).toHaveText("USED");

  for (const name of ["Catamaran Cruise", "Snorkelling"]) {
    const row = verdict.getByTestId("entitlement").filter({ hasText: name });
    await row.getByRole("button", { name: "REDEEM 4" }).click();
    await expect(row.getByTestId("remaining")).toHaveText("USED");
  }
  await verdict.getByRole("button", { name: "SCAN NEXT" }).click();
  await check();
  await expect(verdict).toHaveAttribute("data-verdict", "ALREADY_REDEEMED");
  await expect(lunch).toContainText("3 used");
  await expect(lunch).toContainText("1 used");
  await expect(verdict.getByRole("button", { name: /REDEEM/ })).toHaveCount(0);
});
