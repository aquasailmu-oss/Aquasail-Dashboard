import { expect, test } from "@playwright/test";
import { expectTotal, login, logout, tag } from "./helpers";

test("amend updates the balance and the audit trail; cancel strikes through, never deletes", async ({ page }) => {
  const last = `Amend${tag()}`;
  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await page.fill("#first_name", "Change");
  await page.fill("#last_name", last);
  await page.getByText("Adrenaline Combo", { exact: true }).click();
  await page.fill("#adults", "2");
  await expectTotal(page, "Rs 6,800");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);
  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  await page.getByRole("link", { name: "View booking" }).click();
  await expect(page.getByText(/Balance due\s*Rs 0/)).toBeVisible();

  await page.getByRole("link", { name: "Amend", exact: true }).click();
  await page.fill("#children", "1");
  await expect(page.getByTestId("before-after")).toHaveText("Total was Rs 6,800, now Rs 9,300. Balance due Rs 2,500.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}\?amended=/);
  await expect(page.getByRole("status")).toContainText("Changes saved. Total was Rs 6,800, now Rs 9,300.");
  await expect(page.getByText(/Balance due\s*Rs 2,500/)).toBeVisible();
  const bookingUrl = page.url().split("?")[0];
  await logout(page);

  // The accountant sees the amendment in the booking's audit trail, with the actor.
  await login(page, "accountant");
  await page.goto(`${bookingUrl}/history`);
  await expect(page.locator("details summary", { hasText: "Line added: Adrenaline Combo × 1 child" })).toContainText(
    "Rita Ramsamy",
  );
  await logout(page);

  await login(page, "receptionist");
  await page.goto(bookingUrl);
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.fill("#cancel_reason", "Weather: lagoon closed");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByText("Weather: lagoon closed")).toBeVisible();
  await page.goto("/today");
  await expect(page.locator("tbody tr.line-through", { hasText: reference })).toBeVisible();
  await logout(page);
});
