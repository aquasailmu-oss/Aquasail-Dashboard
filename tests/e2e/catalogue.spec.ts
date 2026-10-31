import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

test("package editor previews an inclusion without a schema runtime error", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/admin/packages/new");
  await page.getByLabel("Add an activity").fill("Tube Ride");
  await page.getByRole("button", { name: /Tube Ride/ }).click();
  await expect(page.getByText("Bundle prices are set in Pricing after the package is saved.")).toBeVisible();
  await logout(page);
});
