import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

const NAV = {
  receptionist: ["Today", "New booking", "Bookings", "Clients", "Daily register"],
  accountant: ["Today", "Bookings", "Clients", "Daily register", "Reports", "Export", "Audit log"],
  activity_staff: ["Scan"],
} as const;

test("signed-out visitors are sent to sign in, and a wrong password is explained", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
  await page.fill("#email", "reception@aquasail.test");
  await page.fill("#password", "wrong-password");
  await page.locator("main button[type=submit]").click();
  await expect(page.locator("main [data-slot=alert]")).toHaveText("Email or password is incorrect.");
  await expect(page.locator("#email")).toHaveValue("reception@aquasail.test");
});

for (const [role, items] of Object.entries(NAV) as [keyof typeof NAV, readonly string[]][]) {
  test(`${role} sees only their own navigation`, async ({ page }) => {
    await login(page, role);
    await expect(page.locator("nav[aria-label=Main] a").filter({ hasText: /\w/ })).toHaveText([...items]);
    await logout(page);
  });
}

test("the wrong role gets a clear refusal", async ({ page }) => {
  await login(page, "receptionist");
  for (const path of ["/admin/pricing", "/admin/users", "/admin/audit", "/bookings/export"]) {
    const res = await page.goto(path);
    if (path.endsWith("export")) expect(res?.status()).toBe(403);
    else await expect(page.getByText("Not available for your role")).toBeVisible();
  }
  await page.goto("/today");
  await logout(page);
});
