import { expect, test } from "@playwright/test";
import { addDays, db, expectTotal, login, logout, tag, today } from "./helpers";

test("price history: a new price from tomorrow leaves today unchanged and prices tomorrow's booking", async ({
  page,
}) => {
  // A fresh activity per run keeps this independent of other tests and reruns.
  const name = `E2E Kayak ${tag()}`;
  const { data: activity } = await db
    .from("activities")
    .insert({ code: `E2E_${tag().toUpperCase()}`, name })
    .select()
    .single();
  await db.from("price_rules").insert({
    scope: "activity",
    activity_id: activity!.id,
    audience: "walk_in",
    participant_type: "adult",
    retail_cents: 100000,
    effective_from: "2026-01-01",
  });

  await login(page, "admin");
  await page.goto("/admin/pricing");
  await page.getByRole("button", { name: `Set ${name} price for Walk-in`, exact: true }).click();
  await expect(page.locator("#effective_from")).toHaveValue(addDays(today(), 1));
  await page.fill("#retail", "1250");
  await expect(page.getByRole("dialog")).toContainText(`then Rs 1,250 from`);
  await page.getByRole("dialog").getByRole("button", { name: "Save price" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const book = async (date: string) => {
    await page.goto("/bookings/new");
    await page.fill("#first_name", `Price${tag()}`);
    await page.selectOption("#add-activity", { label: name });
    await page.getByRole("button", { name: "Add" }).click();
    await page.fill("#service_date", date);
  };
  await book(today());
  await expectTotal(page, "Rs 1,000");
  await book(addDays(today(), 1));
  await expectTotal(page, "Rs 1,250");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);
  await expect(page.getByText("Rs 1,250")).toBeVisible();

  await page.goto(`/admin/pricing/history/activity/${activity!.id}`);
  await expect(page.locator("[data-slot=table-body] tr")).toHaveCount(2);
  await expect(page.locator("[data-slot=table-body]")).toContainText("Scheduled");
  await logout(page);
  await db.from("activities").update({ is_active: false }).eq("id", activity!.id); // keep the catalogue tidy
});
