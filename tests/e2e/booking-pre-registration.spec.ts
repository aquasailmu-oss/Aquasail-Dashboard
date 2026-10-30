import { expect, test } from "@playwright/test";
import { bookingByReference, db, expectTotal, login, logout, selectBookingOperator, tag, today } from "./helpers";

test("a standalone activity can be booked without a package with its own participant quantity", async ({ page }) => {
  const lastName = `Standalone${tag()}`;
  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await selectBookingOperator(page);
  await page.fill("#first_name", "Alex");
  await page.fill("#last_name", lastName);
  await page.selectOption("#add-activity", { label: "Tube Ride" });
  await page.getByRole("button", { name: "Add" }).click();
  const activityAdults = page.locator('input[id^="activity-"][id$="-adult"]');
  await expect(activityAdults).toHaveValue("1");
  await page.fill("#adults", "2");
  await expect(activityAdults).toHaveValue("2");
  await expectTotal(page, "Rs 2,400");

  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);
  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  const booking = await bookingByReference(reference);
  expect(booking?.booking_activities.map((activity) => `${activity.activities?.code}×${activity.quantity}`)).toEqual([
    "TUBE×2",
  ]);
  const { data: purchases } = await db
    .from("booking_items")
    .select("line_type, package_id, activity_id, participant_type, quantity")
    .eq("booking_id", booking!.id);
  expect(purchases).toHaveLength(1);
  expect(purchases?.[0]).toMatchObject({
    line_type: "activity",
    package_id: null,
    participant_type: "adult",
    quantity: 2,
  });
  expect(purchases?.[0].activity_id).toBeTruthy();
  await logout(page);
});

test("a package and standalone activity remain separate purchases but consolidate on the ticket", async ({ page }) => {
  const lastName = `Mixed${tag()}`;
  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await selectBookingOperator(page);
  await page.fill("#first_name", "Sam");
  await page.fill("#last_name", lastName);
  await page.getByText("Island Explorer", { exact: true }).click();
  await page.selectOption("#add-activity", { label: "Snorkelling" });
  await page.getByRole("button", { name: "Add" }).click();

  await page.locator('input[id^="package-"][id$="-adult"]').fill("2");
  await page.locator('input[id^="activity-"][id$="-adult"]').fill("2");
  await page.fill("#adults", "2");
  await expectTotal(page, "Rs 8,600");
  await page.getByRole("radio", { name: /Catamaran A/ }).check();
  await page.selectOption("#method", "pre_book");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);

  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  const booking = await bookingByReference(reference);
  const { data: purchases } = await db
    .from("booking_items")
    .select("line_type, package_id, activity_id, quantity")
    .eq("booking_id", booking!.id)
    .order("sort_order");
  expect(purchases).toHaveLength(2);
  expect(purchases?.map((item) => ({ line_type: item.line_type, quantity: item.quantity }))).toEqual([
    { line_type: "package", quantity: 2 },
    { line_type: "activity", quantity: 2 },
  ]);
  expect(purchases?.[0].package_id).toBeTruthy();
  expect(purchases?.[0].activity_id).toBeNull();
  expect(purchases?.[1].activity_id).toBeTruthy();
  expect(purchases?.[1].package_id).toBeNull();

  await page.getByRole("link", { name: "Print ticket" }).click();
  await page.waitForURL(/\/tickets\/[0-9a-f]{32}\?print=1$/);
  await expect(page.locator("li").filter({ hasText: "Snorkelling" })).toHaveText(/Snorkelling× 4 pax/);
});

test("staff can pre-register a client, then complete and link their booking on arrival", async ({ page }) => {
  const firstName = "PreReg";
  const lastName = `Client${tag()}`;
  const note = "Arrives with the morning group";
  await login(page, "receptionist");

  await page.goto("/pre-registrations/new");
  await page.fill("#pre-first-name", firstName);
  await page.fill("#pre-last-name", lastName);
  await page.locator("#pre-operator").selectOption({ label: "Sofitel Merville" });
  await page.fill("#pre-date", today());
  await page.fill("#pre-notes", note);
  await page.getByRole("button", { name: "Save pre-registration" }).click();
  await page.waitForURL(/\/pre-registrations\?saved=/);
  const registrationId = new URL(page.url()).searchParams.get("saved");
  expect(registrationId).toBeTruthy();
  await expect(page.getByText("Pre-registration saved.")).toBeVisible();

  await page.fill("#pre-registration-search", `${firstName} ${lastName}`);
  await page.getByRole("button", { name: "Search" }).click();
  const row = page.locator("tbody tr").filter({ hasText: lastName });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Complete booking" }).click();
  await page.waitForURL(new RegExp(`/bookings/new\\?pre_registration=${registrationId}`));
  await expect(page.getByText(`${firstName} ${lastName}`)).toBeVisible();
  await expect(page.getByText("Sofitel Merville", { exact: true })).toBeVisible();
  await expect(page.locator("#notes")).toHaveValue(note);

  await page.getByText("Sunset Cruise", { exact: true }).click();
  await expectTotal(page, "Rs 2,100");
  await page.getByRole("radio", { name: /Catamaran A/ }).check();
  await page.selectOption("#method", "pre_book");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);

  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  const booking = await bookingByReference(reference);
  const { data: registration } = await db
    .from("booking_pre_registrations")
    .select("status, booking_id, client_id, operator_id, service_date, notes")
    .eq("id", registrationId!)
    .single();
  expect(registration).toMatchObject({
    status: "completed",
    booking_id: booking!.id,
    operator_id: booking!.operator_id,
    service_date: today(),
    notes: note,
  });
  expect(booking?.client_id).toBe(registration?.client_id);
  await logout(page);
});
