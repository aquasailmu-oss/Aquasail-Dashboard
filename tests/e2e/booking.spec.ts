import { expect, test } from "@playwright/test";
import { bookingByReference, db, expectTotal, login, logout, stubPrint, tag, today } from "./helpers";

async function cashToday(): Promise<number> {
  const start = new Date(`${today()}T00:00:00+04:00`);
  const end = new Date(start.getTime() + 864e5);
  const { data } = await db
    .from("payments")
    .select("amount_cents")
    .eq("method", "cash")
    .gte("received_at", start.toISOString())
    .lt("received_at", end.toISOString());
  return (data ?? []).reduce((s, p) => s + p.amount_cents, 0);
}
const rs = (c: number) => `Rs ${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

test("walk-in, keyboard only: 4 adults, catamaran + lunch, cash, ticket, on Today", async ({ page }) => {
  const name = `Walkin${tag()}`;
  await stubPrint(page);
  await login(page, "receptionist");
  const cashBefore = await cashToday();

  await page.goto("/bookings/new");
  await expect(page.getByText("Rs 3,200 / adult")).toBeVisible();
  await expect(page.locator("#first_name")).toBeFocused();
  const started = Date.now();
  await page.keyboard.type("Anna");
  await page.keyboard.press("Tab");
  await page.keyboard.type(name);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab"); // phone, email, country → Walk-in
  await page.keyboard.press("1"); // Island Explorer: catamaran, snorkelling, lunch
  await expect(page.getByText("Assign a boat")).toBeVisible();
  await page.focus("#adults");
  await page.keyboard.type("4");
  await expectTotal(page, "Rs 12,800");
  await page.focus("input[name=boat]");
  await page.keyboard.press("Space");
  await page.keyboard.press("Control+Enter");
  await page.waitForURL(/\/confirmation$/);
  expect(Date.now() - started, "a keyboard-only booking well under the 45 s target").toBeLessThan(45_000);

  const reference = (await page.getByTestId("booking-reference").textContent())!.trim();
  const booking = await bookingByReference(reference);
  expect(booking?.charged_total_cents).toBe(1280000);
  expect(booking?.payments).toEqual([{ amount_cents: 1280000, method: "cash" }]);
  expect(booking?.booking_activities.map((a) => `${a.activities?.code}×${a.quantity}`).sort()).toEqual([
    "CATAMARAN×4",
    "LUNCH×4",
    "SNORKEL×4",
  ]);

  await page.getByRole("link", { name: "Print ticket" }).click();
  await page.waitForURL(/\/tickets\/[0-9a-f]{32}\?print=1$/);
  await expect(page.getByText("Printed 1 time")).toBeVisible();
  await expect(page.getByTestId("ticket-reference")).toHaveText(reference);

  await page.goto("/today");
  await expect(page.locator("tbody tr", { hasText: reference })).toBeVisible();
  const cash = page
    .locator("main")
    .getByText("Cash collected", { exact: true })
    .locator("xpath=following-sibling::div[1]");
  await expect(cash).toHaveText(rs(cashBefore + 1280000));
  await logout(page);
});

test("discount cap: reception refused at 30%, admin allowed with the reason stored", async ({ page }) => {
  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await page.fill("#first_name", `Cap${tag()}`);
  await page.getByText("Adrenaline Combo", { exact: true }).click();
  await expectTotal(page, "Rs 3,400");
  await page.fill("#discount_value", "30");
  await page.fill("#discount_reason", "Friend of the owner");
  await expect(page.getByText(/Reception can give at most 10% discount/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create booking" })).toBeDisabled();
  await logout(page);

  await login(page, "admin");
  await page.goto("/bookings/new");
  await page.fill("#first_name", `AdminCap${tag()}`);
  await page.getByText("Adrenaline Combo", { exact: true }).click();
  await page.fill("#discount_value", "30");
  await page.fill("#discount_reason", "Friend of the owner");
  await expectTotal(page, "Rs 2,380");
  await page.keyboard.press("Control+Enter");
  await page.waitForURL(/\/confirmation$/);
  const booking = await bookingByReference((await page.getByTestId("booking-reference").textContent())!.trim());
  expect(booking?.discount_total_cents).toBe(102000);
  const { data: lines } = await db.from("booking_items").select("discount_reason").eq("booking_id", booking!.id);
  expect(lines?.every((l) => l.discount_reason === "Friend of the owner")).toBe(true);
  await logout(page);
});

test("idempotency: submitting twice rapidly creates one booking", async ({ page }) => {
  const last = `Twice${tag()}`;
  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await page.fill("#first_name", "Double");
  await page.fill("#last_name", last);
  await page.getByText("Adrenaline Combo", { exact: true }).click();
  await expectTotal(page, "Rs 3,400");
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await page
    .getByRole("button", { name: /Create booking|Creating/ })
    .click({ force: true, noWaitAfter: true })
    .catch(() => {});
  await page.waitForURL(/\/confirmation$/);
  const { data: client } = await db.from("clients").select("id").eq("last_name", last).single();
  const { count } = await db.from("bookings").select("id", { count: "exact", head: true }).eq("client_id", client!.id);
  expect(count).toBe(1);
  await logout(page);
});
