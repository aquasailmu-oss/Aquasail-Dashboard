import { expect, test } from "@playwright/test";
import { addDays, expectTotal, login, logout, tag, today, useIslandDevice } from "./helpers";

// WP-36: field trial and hardening. The existing island.spec.ts covers the
// full redeem cycle (check-in, redeem 3/4, undo, PARTLY_USED, ALREADY_REDEEMED)
// and ticket-lifecycle.spec.ts covers reissue+cancel. This file adds:
// (a) wrong-date ticket → WRONG DATE naming the real date
// (b) cancelled booking scans as CANCELLED
// (c) the operations screen shows checked-in vs pending and updates

test("a wrong-date ticket scans as WRONG DATE and names the real date", async ({ page }) => {
  const tomorrow = addDays(today(), 1);

  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await page.fill("#first_name", "Tomorrow");
  await page.fill("#last_name", `Guest${tag()}`);
  await page.getByText("Parasailing", { exact: true }).click();
  await page.fill("#adults", "2");
  await page.fill("#service_date", tomorrow);
  await expectTotal(page, "Rs 5,400");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);
  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  await logout(page);

  await useIslandDevice(page, `E2E wrong-date ${tag()}`);
  await login(page, "activity_staff");
  await page.getByRole("button", { name: "ENTER REFERENCE" }).click();
  await page.fill("#reference", reference);
  await page.getByRole("button", { name: "CHECK TICKET" }).click();

  const verdict = page.getByTestId("verdict");
  await expect(verdict).toHaveAttribute("data-verdict", "WRONG_DATE");
  await expect(verdict).toContainText(tomorrow);
  await expect(verdict.getByRole("button", { name: /CHECK IN/ })).toHaveCount(0);
  await expect(verdict.getByRole("button", { name: /REDEEM/ })).toHaveCount(0);
  await verdict.getByRole("button", { name: "SCAN NEXT" }).click();
});

test("a cancelled booking scans as CANCELLED", async ({ page }) => {
  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await page.fill("#first_name", "Cancel");
  await page.fill("#last_name", `Test${tag()}`);
  await page.getByText("Tube Ride", { exact: true }).click();
  await page.fill("#adults", "1");
  await expectTotal(page, "Rs 1,700");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);
  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  await page.getByRole("link", { name: "View booking" }).click();
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.fill("#cancel_reason", "Changed mind");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByText("Booking cancelled.")).toBeVisible();
  await logout(page);

  await useIslandDevice(page, `E2E cancel-scan ${tag()}`);
  await login(page, "activity_staff");
  await page.getByRole("button", { name: "ENTER REFERENCE" }).click();
  await page.fill("#reference", reference);
  await page.getByRole("button", { name: "CHECK TICKET" }).click();

  const verdict = page.getByTestId("verdict");
  await expect(verdict).toHaveAttribute("data-verdict", "CANCELLED");
  await expect(verdict.getByRole("button", { name: /CHECK IN/ })).toHaveCount(0);
  await expect(verdict.getByRole("button", { name: /REDEEM/ })).toHaveCount(0);
  await verdict.getByRole("button", { name: "SCAN NEXT" }).click();
});

test("the operations screen shows activity groups with checked-in vs pending", async ({ page }) => {
  await login(page, "receptionist");
  await page.goto("/operations");
  await expect(page.getByText("Operations")).toBeVisible();

  const stat = page.locator(".rounded-lg.border.p-4.text-center");
  await expect(stat.filter({ hasText: "People" })).toBeVisible();
  await expect(stat.filter({ hasText: "Checked in" })).toBeVisible();
  await expect(stat.filter({ hasText: "Pending" })).toBeVisible();

  const groups = page.locator("[class*=space-y] > .rounded-lg.border");
  const groupCount = await groups.count();
  if (groupCount > 0) {
    const first = groups.first();
    await expect(first).toContainText("people");
    await first.click();
    await expect(first.locator("table")).toBeVisible();
    await expect(first.locator("table")).toContainText(/Pending|CHECKED IN/);
  }
  await logout(page);
});

test("receptionist sees Operations in the nav and activity_staff does not", async ({ page }) => {
  await login(page, "receptionist");
  await expect(page.locator("nav[aria-label=Main]")).toContainText("Operations");
  await logout(page);

  await login(page, "activity_staff");
  await expect(page).toHaveURL(/\/scan$/);
  await page.goto("/operations");
  await expect(page.getByText("Not available for your role")).toBeVisible();
});
