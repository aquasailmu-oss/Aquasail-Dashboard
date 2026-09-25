import { expect, test } from "@playwright/test";
import { bookingByReference, db, expectTotal, login, logout, tag } from "./helpers";

test("operator pays: DO NOT COLLECT, unpaid, receivable on the booking", async ({ page }) => {
  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await page.fill("#first_name", `Beach${tag()}`);
  await page.getByRole("radio", { name: /Beachcomber Hotel/ }).check();
  await expect(page.locator("main [role=alert]", { hasText: "Do not collect payment" }).first()).toBeVisible();
  await page.getByText("Sunset Cruise", { exact: true }).click();
  await page.fill("#adults", "2");
  await expectTotal(page, "Rs 3,000");
  await expect(page.locator("#received")).toHaveCount(0);
  await expect(page.getByText("becomes a receivable from Beachcomber Hotel")).toBeVisible();
  await page.getByRole("radio", { name: /Catamaran B/ }).check();
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);

  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  const booking = await bookingByReference(reference);
  expect(booking?.payer).toBe("operator");
  expect(booking?.payments).toEqual([]);
  await page.getByRole("link", { name: "View booking" }).click();
  await expect(page.getByText("Receivable from Beachcomber Hotel:")).toContainText("Rs 3,000");
  await logout(page);
});

test("returning customer by phone: the match banner, and no second client", async ({ page }) => {
  const last = `Returning${tag()}`;
  const phone = `+2305${String(Date.now()).slice(-7)}`;
  await db.from("clients").insert({ first_name: "Existing", last_name: last, phone_e164: phone });
  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await page.fill("#first_name", "Someone");
  await page.fill("#phone", phone.slice(4));
  const banner = page.locator("section[aria-label='Existing customer found']");
  await expect(banner).toContainText(`Existing ${last}`);
  await banner.getByRole("button", { name: "Use this client" }).click();
  await expect(page.locator("#first_name")).toHaveCount(0);
  await page.getByText("Adrenaline Combo", { exact: true }).click();
  await expectTotal(page, "Rs 3,400");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);
  const { count } = await db.from("clients").select("id", { count: "exact", head: true }).eq("phone_e164", phone);
  expect(count).toBe(1);
  await logout(page);
});
