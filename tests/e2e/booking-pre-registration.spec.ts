import { expect, test } from "@playwright/test";
import {
  addDays,
  bookingByReference,
  db,
  expectTotal,
  login,
  logout,
  selectBookingOperator,
  tag,
  today,
} from "./helpers";

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
  await expect(activityAdults).toHaveValue("1");
  await expectTotal(page, "Rs 1,200");

  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);
  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  const booking = await bookingByReference(reference);
  expect(booking?.booking_activities.map((activity) => `${activity.activities?.code}×${activity.quantity}`)).toEqual([
    "TUBE×1",
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
    quantity: 1,
  });
  expect(purchases?.[0].activity_id).toBeTruthy();
  await logout(page);
});

test("one double package unit is charged once and combines its inclusions with standalone activities on the ticket", async ({
  page,
}) => {
  const suffix = tag().slice(-7).toUpperCase();
  const activityCode = `DBLPARA_${suffix}`;
  const packageCode = `DBLCOMBO_${suffix}`;
  const activityName = `Parasailing Single ${suffix}`;
  const packageName = `Combo Double ${suffix}`;
  const { data: activity, error: activityError } = await db
    .from("activities")
    .insert({ code: activityCode, name: activityName, participants_per_unit: 1, sort_order: 9990 })
    .select("id")
    .single();
  expect(activityError).toBeNull();
  const { data: pkg, error: packageError } = await db
    .from("packages")
    .insert({
      code: packageCode,
      name: packageName,
      description: "Two-person test package",
      pricing_mode: "bundle",
      sale_unit: "package",
      participants_per_unit: 2,
      sort_order: 9990,
    })
    .select("id")
    .single();
  expect(packageError).toBeNull();
  await db.from("package_activities").insert({
    package_id: pkg!.id,
    activity_id: activity!.id,
    quantity_per_participant: 2,
    sort_order: 10,
  });
  await db.from("price_rules").insert([
    {
      scope: "package",
      package_id: pkg!.id,
      audience: "walk_in",
      participant_type: "adult",
      retail_cents: 830000,
      effective_from: today(),
    },
    {
      scope: "activity",
      activity_id: activity!.id,
      audience: "walk_in",
      participant_type: "adult",
      retail_cents: 120000,
      effective_from: today(),
    },
  ]);

  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await selectBookingOperator(page);
  await page.fill("#service_date", addDays(today(), 1));
  await page.fill("#first_name", "Double");
  await page.fill("#last_name", `Unit${suffix}`);
  await page.getByText(packageName, { exact: true }).click();
  await expect(page.getByText("1 package unit covers 2 people").first()).toBeVisible();
  await expect(page.locator("#adults")).toHaveValue("2");
  await expectTotal(page, "Rs 8,300");

  await page.selectOption("#add-activity", { label: activityName });
  await page.getByRole("button", { name: "Add" }).click();
  const standalonePax = page.locator('input[id^="activity-"][id$="-adult"]');
  await standalonePax.fill("1");
  await expect(page.locator("#adults")).toHaveValue("2");
  await expectTotal(page, "Rs 9,500");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);

  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  const booking = await bookingByReference(reference);
  expect(booking?.booking_activities).toHaveLength(2);
  expect(booking?.booking_activities.reduce((total, item) => total + item.quantity, 0)).toBe(3);
  const { data: purchaseLines } = await db
    .from("booking_items")
    .select("line_type, quantity, sale_unit_snapshot, participants_per_unit_snapshot")
    .eq("booking_id", booking!.id)
    .order("sort_order");
  expect(purchaseLines).toEqual([
    {
      line_type: "package",
      quantity: 1,
      sale_unit_snapshot: "package",
      participants_per_unit_snapshot: 2,
    },
    {
      line_type: "activity",
      quantity: 1,
      sale_unit_snapshot: "participant",
      participants_per_unit_snapshot: 1,
    },
  ]);
  expect(booking?.charged_total_cents).toBe(950000);

  await page.getByRole("link", { name: "Print ticket" }).click();
  await page.waitForURL(/\/tickets\/[0-9a-f]{32}\?print=1$/);
  await expect(page.locator("li").filter({ hasText: activityName })).toHaveText(new RegExp(`${activityName}×3 pax`));
  await expect(page.getByTestId("activity-check-box")).toHaveCount(1);
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
  await expect(page.locator("li").filter({ hasText: "Snorkelling" })).toHaveText(/Snorkelling×4 pax/);
  await expect(page.getByTestId("activity-check-box")).toHaveCount(3);
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
